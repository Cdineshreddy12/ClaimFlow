import {
  PREAUTH_FIELDS,
  PREAUTH_FIELD_BY_KEY,
  parsePreauthValue,
} from "@claimflow/contracts";
import {
  getPreauthExtractor,
  hasPreauthExtractor,
  type ExtractionDocument,
} from "../../integrations/preauth/index.js";
import { canOcr, detectText } from "../../integrations/ocr/textract.js";
import { getObjectBytes } from "../../integrations/storage/s3.js";
import * as auditService from "../audit/audit.service.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as documentsRepository from "../documents/documents.repository.js";
import { getMemberId } from "../members/members.repository.js";
import * as preauthRepository from "./preauth.repository.js";

export class ClaimNotFoundError extends Error {}
export class UnknownFieldError extends Error {}
export class InvalidFieldValueError extends Error {}
/** The read itself failed — distinct from a read that ran and found nothing. */
export class ExtractionFailedError extends Error {}

interface AuthContext {
  userId: string;
}

/** Guessed from the stored key, which is all we keep — the extractor only needs image vs PDF. */
function contentTypeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

/** Strips the uuid prefix buildObjectKey adds, back to what the user uploaded. */
function displayFileName(key: string): string {
  const base = key.split("/").pop() ?? key;
  return base.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/,
    "",
  );
}

export async function listFields(auth: AuthContext, claimId: string) {
  const rows = await preauthRepository.listForClaim(claimId);
  if (rows === undefined) throw new ClaimNotFoundError(claimId);
  // The web app renders from the catalogue in @claimflow/contracts, so
  // this only has to carry the rows plus whether the action is wired up.
  return { fields: rows, extractionAvailable: hasPreauthExtractor() };
}

/**
 * Reads the claim's confirmed documents and proposes values for the
 * pre-auth fields still blank.
 *
 * Only confirmed documents, and only unconfirmed fields. The first is
 * because an unconfirmed upload hasn't been vouched for as being what
 * the classifier guessed, and reading a figure off a misfiled page puts
 * it on a form nobody re-checks. The second is so re-running this after
 * uploading one more document can't disturb values a human already
 * stood behind.
 *
 * Explicitly triggered rather than firing on every document confirm: a
 * desk uploading six files would otherwise pay for six multi-document
 * reads, five of them superseded.
 */
export async function extractFields(auth: AuthContext, claimId: string) {
  const claim = await claimsRepository.getClaimById(claimId);
  if (!claim) throw new ClaimNotFoundError(claimId);

  const existing = (await preauthRepository.listForClaim(claimId)) ?? [];
  const confirmedKeys = new Set(
    existing.filter((row) => row.confirmedAt).map((row) => row.fieldKey),
  );
  const fields = PREAUTH_FIELDS.filter((f) => !confirmedKeys.has(f.key));

  const allDocuments = (await documentsRepository.listForClaim(claimId)) ?? [];
  const confirmed = allDocuments.filter(
    (doc) => doc.confirmedAt && doc.checklistSlot,
  );

  if (fields.length === 0 || confirmed.length === 0) {
    // Nothing was read, so say nothing was read — either every field is
    // already settled or there's no confirmed document to read from.
    return {
      extracted: 0,
      documentsRead: 0,
      documentsSkipped: 0,
      fieldsRemaining: fields.length,
      extractionAvailable: hasPreauthExtractor(),
    };
  }

  const documents: ExtractionDocument[] = confirmed.map((doc) => {
    const contentType = contentTypeFromKey(doc.fileUrl);
    let cached: Uint8Array | undefined;
    const readBytes = async () =>
      (cached ??= await getObjectBytes(doc.fileUrl));
    return {
      id: doc.id,
      fileName: displayFileName(doc.fileUrl),
      contentType,
      checklistSlot: doc.checklistSlot!,
      readBytes,
      ocrText: undefined as string | undefined,
    };
  });

  // OCR the images first, same reasoning as the classifier: the values
  // on this form come off handwritten doctors' notes more than anything
  // else, and that's where character extraction beats a vision model.
  await Promise.all(
    documents.map(async (doc) => {
      if (!canOcr(doc.contentType)) return;
      try {
        const result = await detectText(await doc.readBytes());
        doc.ocrText = result?.text;
      } catch (err) {
        console.error("OCR failed, extracting without it", {
          documentId: doc.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  // A failed read is reported, not swallowed. Unlike classification —
  // which is a side effect of an upload the desk didn't ask for — this
  // is a button someone pressed, and silently returning "found nothing"
  // would read as the documents being empty rather than the call failing.
  let outcome;
  try {
    outcome = await getPreauthExtractor().extract({
      fields,
      documents,
      patientName: claim.patientName,
      procedureName: claim.procedureName,
    });
  } catch (err) {
    console.error("pre-auth extraction failed", {
      claimId,
      documents: documents.length,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ExtractionFailedError(
      err instanceof Error ? err.message : String(err),
    );
  }

  const saved = await preauthRepository.saveSuggestions(
    claimId,
    outcome.fields.map((e) => ({
      fieldKey: e.fieldKey,
      aiValue: e.value,
      confidence: e.confidence,
      sourceSnippet: e.sourceSnippet,
      sourceDocumentId: e.sourceDocumentId ?? null,
      extractedBy: "claude",
    })),
    new Date(),
  );

  await auditService.record(auth, {
    action: "preauth.extracted",
    entityType: "claim",
    entityId: claimId,
    after: {
      documentsRead: outcome.documentsRead,
      documentsOffered: documents.length,
      fieldsSuggested: saved.length,
      fieldKeys: outcome.fields.map((e) => e.fieldKey),
    },
  });

  return {
    extracted: saved.length,
    // What was actually read, not what was offered — a .txt note and a
    // thumbnail-sized scan get skipped, and saying otherwise would tell
    // a desk their documents were read when they weren't.
    documentsRead: outcome.documentsRead,
    documentsSkipped: documents.length - outcome.documentsRead,
    fieldsRemaining: fields.length - saved.length,
    extractionAvailable: hasPreauthExtractor(),
  };
}

/**
 * The human-confirm step docs/adr/0005 requires. The value is validated
 * against the field's own type here, not just at the extractor — a desk
 * executive correcting a figure by hand goes through exactly the same
 * gate the model's answer did.
 */
export async function confirmField(
  auth: AuthContext,
  claimId: string,
  fieldKey: string,
  rawValue: string,
) {
  const field = PREAUTH_FIELD_BY_KEY[fieldKey];
  if (!field) throw new UnknownFieldError(fieldKey);

  const value = parsePreauthValue(field, rawValue);
  if (value === null) throw new InvalidFieldValueError(fieldKey);

  const memberId = await getMemberId(auth.userId);
  const row = await preauthRepository.confirm(
    claimId,
    fieldKey,
    value,
    memberId,
  );
  if (!row) throw new ClaimNotFoundError(claimId);

  await writeThroughToClaim(auth, claimId, fieldKey, value);

  await auditService.record(auth, {
    action: "preauth.field_confirmed",
    entityType: "claim",
    entityId: claimId,
    before: { fieldKey, aiValue: row.aiValue },
    after: { fieldKey, value },
    actorId: memberId,
  });

  return row;
}

/**
 * Two of these fields are facts the rest of the app already reads off
 * `claims` — the header's admission date and the dashboard's billed
 * amount. Confirming them here updates those columns so there's one
 * answer rather than two.
 *
 * Admission date and time are separate fields because the form asks for
 * them separately; a confirmed date with no time lands at midnight,
 * which is what the desk would write anyway.
 */
async function writeThroughToClaim(
  auth: AuthContext,
  claimId: string,
  fieldKey: string,
  value: string,
) {
  if (fieldKey === "totalExpectedCost") {
    await claimsRepository.updateConfirmedFacts(claimId, {
      billedAmount: value,
    });
    return;
  }

  if (fieldKey !== "admissionDate" && fieldKey !== "admissionTime") return;

  const rows = (await preauthRepository.listForClaim(claimId)) ?? [];
  const byKey = new Map(rows.map((r) => [r.fieldKey, r]));
  const date =
    fieldKey === "admissionDate" ? value : byKey.get("admissionDate")?.value;
  if (!date) return;
  const time =
    fieldKey === "admissionTime" ? value : byKey.get("admissionTime")?.value;

  const admittedAt = new Date(`${date}T${time ?? "00:00"}:00`);
  if (Number.isNaN(admittedAt.getTime())) return;

  await claimsRepository.updateConfirmedFacts(claimId, {
    admittedAt,
  });
}

/** Puts a field back to needing a decision, leaving any suggestion visible. */
export async function clearField(
  auth: AuthContext,
  claimId: string,
  fieldKey: string,
) {
  if (!PREAUTH_FIELD_BY_KEY[fieldKey]) throw new UnknownFieldError(fieldKey);
  const row = await preauthRepository.clearValue(claimId, fieldKey);
  if (!row) throw new ClaimNotFoundError(claimId);

  await auditService.record(auth, {
    action: "preauth.field_cleared",
    entityType: "claim",
    entityId: claimId,
    before: { fieldKey },
  });

  return row;
}
