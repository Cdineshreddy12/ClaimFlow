import {
  PREAUTH_FIELDS,
  PREAUTH_FIELD_BY_KEY,
  parsePreauthValue,
  reviewPreauthForm,
  sortFindings,
  layoutPlacements,
  type PreauthReview,
  type PreauthTemplate,
} from "@claimflow/contracts";
import { getFormAuditor } from "../../integrations/auditor/claude.js";
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
import * as hospitalRepository from "../hospital/hospital.repository.js";
import { buildPreauthForm } from "./preauth-form.builder.js";
import * as preauthLayoutsService from "../preauth-layouts/preauth-layouts.service.js";
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

  // OCR the images first, same reasoning as the classifier: the values on
  // this form come off handwritten doctors' notes more than anything else,
  // and that's where character extraction beats a vision model.
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

  // A failed read is reported, not swallowed.
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
    // thumbnail-sized scan get skipped, and saying otherwise would tell a
    // desk their documents were read when they weren't.
    documentsRead: outcome.documentsRead,
    documentsSkipped: documents.length - outcome.documentsRead,
    fieldsRemaining: fields.length - saved.length,
    extractionAvailable: hasPreauthExtractor(),
  };
}

/** The human-confirm step docs/adr/0005 requires. */
/** Finds a field by key on the claim's own form. */
async function fieldOnClaim(
  claimId: string,
  fieldKey: string,
): Promise<
  | {
      type: string;
      options?: { value: string; label: string }[] | null | undefined;
    }
  | undefined
> {
  const layout = await preauthLayoutsService.layoutForClaim(claimId);
  const placement = layoutPlacements(layout).find(
    (p) => p.definition.fieldKey === fieldKey,
  );
  if (placement) {
    return {
      type: placement.definition.fieldType,
      options: placement.definition.options,
    };
  }
  // A value recorded before the field was taken off the form is still
  // editable — removing a field from a layout isn't meant to strand what it
  // already held.
  const standard = PREAUTH_FIELD_BY_KEY[fieldKey];
  return standard
    ? { type: standard.type, options: standard.options }
    : undefined;
}

export async function confirmField(
  auth: AuthContext,
  claimId: string,
  fieldKey: string,
  rawValue: string,
) {
  const field = await fieldOnClaim(claimId, fieldKey);
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
 * Admission date and time are facts the rest of the app reads off `claims`,
 * so confirming them here updates that column and there is one answer
 * rather than two (docs/adr/0012).
 */
/** The clock a form's "Time of admission" is written on. */
const IST_OFFSET = "+05:30";

async function writeThroughToClaim(
  auth: AuthContext,
  claimId: string,
  fieldKey: string,
  value: string,
) {
  if (fieldKey !== "admissionDate" && fieldKey !== "admissionTime") return;

  const rows = (await preauthRepository.listForClaim(claimId)) ?? [];
  const byKey = new Map(rows.map((r) => [r.fieldKey, r]));
  const date =
    fieldKey === "admissionDate" ? value : byKey.get("admissionDate")?.value;
  if (!date) return;
  const time =
    fieldKey === "admissionTime" ? value : byKey.get("admissionTime")?.value;

  const admittedAt = new Date(`${date}T${time ?? "00:00"}:00${IST_OFFSET}`);
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
  if (!(await fieldOnClaim(claimId, fieldKey))) {
    throw new UnknownFieldError(fieldKey);
  }
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

/** Reads the form against itself before it goes to an insurer. */
export async function reviewClaimForm(
  auth: AuthContext,
  claimId: string,
): Promise<PreauthReview> {
  const claim = await claimsRepository.getClaimById(claimId);
  if (!claim) throw new ClaimNotFoundError(claimId);

  const rows = (await preauthRepository.listForClaim(claimId)) ?? [];

  // Confirmed values only.
  const confirmed = rows.filter((row) => row.confirmedAt && row.value);
  const values: Record<string, string | null> = {};
  for (const row of confirmed) values[row.fieldKey] = row.value;

  const findings = [...reviewPreauthForm(values)];

  const auditor = getFormAuditor();
  let clinicalReviewRan = false;
  if (auditor && confirmed.length > 0) {
    try {
      const clinical = await auditor.audit({
        fields: confirmed.map((row) => ({
          key: row.fieldKey,
          label: PREAUTH_FIELD_BY_KEY[row.fieldKey]?.label ?? row.fieldKey,
          value: row.value!,
        })),
        procedureName: claim.procedureName,
      });
      findings.push(...clinical);
      clinicalReviewRan = true;
    } catch (err) {
      console.error("form clinical review failed", {
        claimId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sorted = sortFindings(findings);
  return {
    findings: sorted,
    blockers: sorted.filter((f) => f.severity === "blocker").length,
    warnings: sorted.filter((f) => f.severity === "warning").length,
    clinicalReviewRan,
  };
}

/** Renders the filled form as a printable PDF (docs/adr/0005). */
/**
 * The upload endpoint only ever accepts these two (see hospital.schema.ts's
 * RequestLogoUploadUrlBody), and buildHospitalLogoKey keeps the original
 * extension — so the key alone says which one a given logo is without a
 * content-type column to keep in sync.
 */
function logoContentTypeFromKey(key: string): "image/png" | "image/jpeg" {
  return key.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

export async function renderPreauthForm(auth: AuthContext, claimId: string) {
  const claim = await claimsRepository.getClaimById(claimId);
  if (!claim) throw new ClaimNotFoundError(claimId);

  const hospital = await hospitalRepository.get();
  if (!hospital) throw new ClaimNotFoundError(claimId);

  // Never fatal: a logo that's briefly unreachable in S3 must not stop a
  // desk from printing a form they need right now — it just prints without
  // the mark that time.
  const logo = hospital.logoFileKey
    ? await getObjectBytes(hospital.logoFileKey)
        .then((bytes) => ({
          bytes,
          contentType: logoContentTypeFromKey(hospital.logoFileKey!),
        }))
        .catch(() => null)
    : null;

  const rows = (await preauthRepository.listForClaim(claimId)) ?? [];
  // The claim's own frozen layout, not the live one: a printed form has
  // to match the form that was filled in (docs/adr/0001).
  const layout = await preauthLayoutsService.layoutForClaim(claimId);

  const address = [
    hospital.addressLine1,
    hospital.addressLine2,
    hospital.city,
    hospital.state,
    hospital.pincode,
  ]
    .filter(Boolean)
    .join(", ");

  const values = layoutPlacements(layout).map((placement) => {
    const def = placement.definition;
    const row = rows.find((r) => r.fieldKey === def.fieldKey);
    const confirmed = Boolean(row?.confirmedAt && row.value);
    return {
      fieldKey: def.fieldKey,
      display: confirmed ? formatForPrint(def, row!.value!) : null,
      raw: confirmed ? row!.value! : null,
      confirmed,
    };
  });

  const bytes = await buildPreauthForm(
    {
      name: hospital.name,
      address,
      rohiniId: hospital.rohiniId,
      registrationNumber: hospital.registrationNumber,
      deskContactName: hospital.deskContactName,
      deskContactPhone: hospital.deskContactPhone,
      tagline: hospital.tagline,
      footerNote: hospital.documentFooterNote,
      accentColorHex: hospital.brandAccentColor,
      preauthTemplate: hospital.preauthTemplate as PreauthTemplate | null,
      preauthOptions: hospital.preauthOptions,
      logo,
    },
    {
      reference: claim.reference,
      patientName: claim.patientName,
      insurerName: claim.insurerName,
      procedureName: claim.procedureName,
    },
    layout,
    values,
    new Date(),
  );

  await auditService.record(auth, {
    action: "preauth.form_printed",
    entityType: "claim",
    entityId: claimId,
    after: { confirmedFields: values.filter((v) => v.confirmed).length },
  });

  return { bytes, fileName: `preauth-${claim.reference}.pdf` };
}

/** Print form of a stored value. */
function formatForPrint(
  field: {
    fieldType: string;
    options: { value: string; label: string }[] | null;
  },
  value: string,
): string {
  if (field.fieldType === "enum") {
    return field.options?.find((o) => o.value === value)?.label ?? value;
  }
  if (field.fieldType === "currency") {
    return Number(value).toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
  return value;
}
