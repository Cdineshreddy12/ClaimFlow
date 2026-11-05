import {
  PREAUTH_FIELDS,
  PREAUTH_GROUP_LABEL,
  PreauthFieldGroup,
  PreauthLayout,
  defaultLayout,
} from "@claimflow/contracts";
import * as auditService from "../audit/audit.service.js";
import * as claimsRepository from "../claims/claims.repository.js";
import * as repo from "./preauth-layouts.repository.js";

export class LayoutNotFoundError extends Error {}
export class StandardFieldError extends Error {}

interface AuthContext {
  userId: string;
}

/**
 * Makes sure the 24 IRDAI definitions and the fallback layout exist.
 *
 * Idempotent and safe to call on every resolve: a fresh install, or one
 * upgraded from the hardcoded form, has no rows yet and would otherwise
 * show an empty form. Seeded from PREAUTH_FIELDS rather than a second
 * copy of the list, so the catalogue the extractor and the PDF read
 * can't drift from the one the desk fills in.
 */
export async function ensureSeeded(): Promise<void> {
  const existing = await repo.listDefinitions();
  const byKey = new Map(existing.map((d) => [d.fieldKey, d]));

  for (const field of PREAUTH_FIELDS) {
    if (byKey.has(field.key)) continue;
    const created = await repo.createDefinition({
      fieldKey: field.key,
      label: field.label,
      fieldType: field.type,
      hint: field.hint ?? null,
      options: field.options ? [...field.options] : null,
      isStandard: true,
      conditionalOn: field.conditionalOn
        ? {
            fieldKey: field.conditionalOn.key,
            equals: field.conditionalOn.equals,
          }
        : null,
    });
    if (created) byKey.set(created.fieldKey, created);
  }

  if (await repo.findLayoutRow(null)) return;

  const layout = await repo.createLayout("IRDAI standard form", null);
  if (!layout) throw new Error("failed to create the default layout");

  for (const [index, group] of PreauthFieldGroup.options.entries()) {
    const section = await repo.createSection(
      layout.id,
      PREAUTH_GROUP_LABEL[group],
      index,
    );
    if (section) await repo.setSectionColumns(section.id, 2);
    if (!section) continue;
    const fields = PREAUTH_FIELDS.filter((f) => f.group === group);
    // Counts only the fields that actually pair up. Alternating on the
    // index into the whole group looked equivalent and wasn't: a prose
    // field pinned to the left column still consumed an index, which
    // flipped the parity of everything after it. Two of those in one
    // section is how Clinical details ended up nine fields against
    // three, with half the section blank.
    let shortFields = 0;
    for (const [order, field] of fields.entries()) {
      const definition = byKey.get(field.key);
      if (!definition) continue;
      const isProse = field.type === "longtext";
      await repo.createPlacement({
        sectionId: section.id,
        fieldDefinitionId: definition.id,
        displayOrder: order,
        // Prose reads badly at half width, so it takes the left column
        // and the short fields pair up around it.
        columnPosition: isProse ? 0 : shortFields++ % 2,
        // Nothing is required: a desk routinely sends a partial
        // pre-auth and completes it on query. The gap view surfaces
        // incompleteness, not a blocked save.
        required: false,
      });
    }
  }
}

export class AlreadyCustomisedError extends Error {}

/**
 * Gives one insurer a pre-auth form of their own.
 *
 * The schema has carried `preauth_layouts.insurer_id` from the start,
 * and `findLayoutRow` has always preferred an insurer's own layout over
 * the shared default — but nothing could create one. Every write route
 * is addressed by section or placement id, so they were all editing
 * whichever layout they happened to resolve to, which was always the
 * default. The capability was readable and unreachable.
 *
 * Cloned from what that insurer resolves to today rather than started
 * blank: a desk customising Star Health's form wants the IRDAI form
 * with three things moved, not an empty page.
 */
export async function customiseForInsurer(
  auth: AuthContext,
  insurerId: string,
): Promise<PreauthLayout> {
  await ensureSeeded();

  const existing = await repo.findLayoutRow(insurerId);
  if (existing?.insurerId === insurerId) {
    throw new AlreadyCustomisedError(insurerId);
  }

  const source = await resolveLayout(insurerId);
  const created = await repo.createLayout(source.name, insurerId);
  if (!created) throw new LayoutNotFoundError(insurerId);

  for (const section of source.sections) {
    const copy = await repo.createSection(
      created.id,
      section.name,
      section.displayOrder,
    );
    if (!copy) continue;
    await repo.setSectionColumns(copy.id, section.columnCount);
    for (const placement of section.placements) {
      await repo.createPlacement({
        sectionId: copy.id,
        fieldDefinitionId: placement.definition.id,
        displayOrder: placement.displayOrder,
        columnPosition: placement.columnPosition,
        labelOverride: placement.labelOverride,
        required: placement.required,
      });
    }
  }

  await auditService.record(auth, {
    action: "preauth_layout.updated",
    entityType: "preauth_layout",
    entityId: created.id,
    after: { insurerId, clonedFrom: source.name },
  });

  return (await repo.hydrate(created.id)) ?? defaultLayout();
}

/**
 * Drops an insurer's own form so they fall back to the shared one.
 *
 * Claims already opened are untouched — each carries the layout it was
 * created under (docs/adr/0001's rule, applied to the form).
 */
export async function revertToDefault(auth: AuthContext, insurerId: string) {
  const own = await repo.findLayoutRow(insurerId);
  if (own?.insurerId !== insurerId) throw new LayoutNotFoundError(insurerId);

  await repo.deleteLayout(own.id);
  await auditService.record(auth, {
    action: "preauth_layout.updated",
    entityType: "preauth_layout",
    entityId: own.id,
    before: { insurerId },
    after: { insurerId: null },
  });
}

/** The live layout for an insurer — theirs, or the fallback. */
export async function resolveLayout(
  insurerId: string | null,
): Promise<PreauthLayout> {
  await ensureSeeded();
  const row = await repo.findLayoutRow(insurerId);
  // Falls back to the in-code IRDAI form rather than an empty one: a
  // blank pre-auth screen looks like data loss, and this is always a
  // correct answer.
  if (!row) return defaultLayout();
  return (await repo.hydrate(row.id)) ?? defaultLayout();
}

/**
 * The layout a given claim was opened under.
 *
 * The snapshot wins whenever there is one. Same rule as the document
 * checklist (docs/adr/0001) and for the same reason: a TPA query six
 * weeks later has to be answerable against the form that was actually
 * sent, not whatever the form looks like today.
 */
export async function layoutForClaim(claimId: string): Promise<PreauthLayout> {
  const claim = await claimsRepository.getClaimById(claimId);
  if (!claim) throw new LayoutNotFoundError(claimId);

  const snapshot = claim.preauthLayoutSnapshot;
  if (snapshot) {
    const parsed = PreauthLayout.safeParse(snapshot);
    if (parsed.success) return parsed.data;
    // A snapshot that no longer parses means the shape changed under
    // it. Falling back to the live layout is better than failing the
    // screen, but it is a real inconsistency, so say so.
    console.error("unreadable preauth layout snapshot, using live layout", {
      claimId,
    });
  }
  return resolveLayout(claim.insurerId);
}

export function listDefinitions() {
  return repo.listDefinitions();
}

export function listLayouts() {
  return repo.listLayouts();
}

export async function getLayout(insurerId: string | null) {
  return resolveLayout(insurerId);
}

export async function addSection(
  auth: AuthContext,
  layoutId: string,
  name: string,
  displayOrder: number,
) {
  const section = await repo.createSection(layoutId, name, displayOrder);
  if (!section) throw new LayoutNotFoundError(layoutId);
  await auditService.record(auth, {
    action: "preauth_layout.updated",
    entityType: "preauth_layout",
    entityId: layoutId,
    after: { addedSection: name },
  });
  return section;
}

export async function renameSection(
  auth: AuthContext,
  id: string,
  name: string,
) {
  const section = await repo.renameSection(id, name);
  if (!section) throw new LayoutNotFoundError(id);
  await auditService.record(auth, {
    action: "preauth_layout.updated",
    entityType: "preauth_layout",
    entityId: section.layoutId,
    after: { renamedSection: name },
  });
  return section;
}

export async function removeSection(auth: AuthContext, id: string) {
  const section = await repo.deleteSection(id);
  if (!section) throw new LayoutNotFoundError(id);
  await auditService.record(auth, {
    action: "preauth_layout.updated",
    entityType: "preauth_layout",
    entityId: section.layoutId,
    before: { removedSection: section.name },
  });
}

export async function addField(
  auth: AuthContext,
  sectionId: string,
  fieldDefinitionId: string,
  displayOrder: number,
  columnPosition = 0,
) {
  const placement = await repo.createPlacement({
    sectionId,
    fieldDefinitionId,
    displayOrder,
    columnPosition,
  });
  if (!placement) throw new LayoutNotFoundError(sectionId);
  await auditService.record(auth, {
    action: "preauth_layout.updated",
    entityType: "preauth_layout",
    entityId: sectionId,
    after: { addedField: fieldDefinitionId },
  });
  return placement;
}

export async function updatePlacement(
  auth: AuthContext,
  id: string,
  values: {
    labelOverride?: string | null | undefined;
    required?: boolean | undefined;
  },
) {
  // Built explicitly rather than spread: exactOptionalPropertyTypes
  // means an explicit `undefined` is not the same as an absent key, and
  // passing one through would blank the column.
  const patch: { labelOverride?: string | null; required?: boolean } = {};
  if (values.labelOverride !== undefined) {
    patch.labelOverride = values.labelOverride;
  }
  if (values.required !== undefined) patch.required = values.required;

  const placement = await repo.updatePlacement(id, patch);
  if (!placement) throw new LayoutNotFoundError(id);
  await auditService.record(auth, {
    action: "preauth_layout.updated",
    entityType: "preauth_layout",
    entityId: placement.sectionId,
    after: values,
  });
  return placement;
}

export async function removeField(auth: AuthContext, id: string) {
  const placement = await repo.deletePlacement(id);
  if (!placement) throw new LayoutNotFoundError(id);
  await auditService.record(auth, {
    action: "preauth_layout.updated",
    entityType: "preauth_layout",
    entityId: placement.sectionId,
    before: { removedPlacement: id },
  });
}

export function reorder(
  order: {
    id: string;
    sectionId: string;
    displayOrder: number;
    columnPosition?: number | undefined;
  }[],
) {
  return repo.reorderPlacements(order);
}

export function reorderSections(order: { id: string; displayOrder: number }[]) {
  return repo.reorderSections(order);
}

export async function setSectionColumns(
  auth: AuthContext,
  id: string,
  columnCount: number,
) {
  const section = await repo.setSectionColumns(id, columnCount);
  if (!section) throw new LayoutNotFoundError(id);
  await auditService.record(auth, {
    action: "preauth_layout.updated",
    entityType: "preauth_layout",
    entityId: section.layoutId,
    after: { section: section.name, columnCount },
  });
  return section;
}

/**
 * A field the hospital invented. Standard fields are seeded, never
 * created here — and a custom key may not shadow one, or a value would
 * be filed under a name the extractor and the PDF already mean
 * something else by.
 */
export async function createCustomField(
  auth: AuthContext,
  input: {
    fieldKey: string;
    label: string;
    fieldType: string;
    hint?: string | null | undefined;
    options?: { value: string; label: string }[] | null | undefined;
  },
) {
  if (PREAUTH_FIELDS.some((f) => f.key === input.fieldKey)) {
    throw new StandardFieldError(input.fieldKey);
  }
  if (await repo.getDefinitionByKey(input.fieldKey)) {
    throw new StandardFieldError(input.fieldKey);
  }

  const created = await repo.createDefinition({
    fieldKey: input.fieldKey,
    label: input.label,
    fieldType: input.fieldType,
    hint: input.hint ?? null,
    options: input.options ?? null,
    isStandard: false,
  });
  if (!created) throw new Error("failed to create the field");

  await auditService.record(auth, {
    action: "preauth_field.created",
    entityType: "preauth_field",
    entityId: created.id,
    after: { fieldKey: created.fieldKey, label: created.label },
  });
  return created;
}

export async function deleteCustomField(auth: AuthContext, id: string) {
  const definitions = await repo.listDefinitions();
  const definition = definitions.find((d) => d.id === id);
  if (!definition) throw new LayoutNotFoundError(id);
  // Deleting a standard field would leave the extractor and the printed
  // form referring to something the layout no longer has.
  if (definition.isStandard) throw new StandardFieldError(definition.fieldKey);

  await repo.deleteDefinition(id);
  await auditService.record(auth, {
    action: "preauth_field.deleted",
    entityType: "preauth_field",
    entityId: id,
    before: { fieldKey: definition.fieldKey },
  });
}
