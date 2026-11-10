import {
  pruneToFields,
  slugify,
  takesOptions,
  validateRecord,
  type CustomFieldInput,
  type CustomModuleInput,
  type Role,
} from "@claimflow/contracts";
import * as auditService from "../audit/audit.service.js";
import { getMemberId } from "../members/members.repository.js";
import * as repo from "./custom-modules.repository.js";

export class ModuleNotFoundError extends Error {}
export class RecordNotFoundError extends Error {}
export class FieldNotFoundError extends Error {}
export class DuplicateModuleError extends Error {}
export class DuplicateFieldError extends Error {}
export class ModuleInUseError extends Error {
  constructor(public readonly records: number) {
    super(`module holds ${records} records`);
  }
}
export class RecordInvalidError extends Error {
  constructor(public readonly errors: { fieldKey: string; message: string }[]) {
    super("record does not match the module's fields");
  }
}

interface AuthContext {
  userId: string;
  role: Role;
}

export function listModules(includeInactive = false) {
  return repo.listModules(includeInactive);
}

export async function getModule(slug: string) {
  const module = await repo.getModuleBySlug(slug);
  if (!module) throw new ModuleNotFoundError(slug);
  return module;
}

export async function createModule(
  auth: AuthContext,
  input: CustomModuleInput,
) {
  const slug = slugify(input.name);
  if (!slug) throw new DuplicateModuleError(input.name);
  if (await repo.findBySlug(slug)) throw new DuplicateModuleError(input.name);

  const created = await repo.createModule({
    name: input.name,
    pluralName: input.pluralName,
    slug,
    description: input.description ?? null,
  });
  if (!created) throw new Error("failed to create module");

  await auditService.record(auth, {
    action: "custom_module.created",
    entityType: "custom_module",
    entityId: created.id,
    after: { name: created.name, slug: created.slug },
  });
  return created;
}

export async function updateModule(
  auth: AuthContext,
  id: string,
  input: CustomModuleInput,
) {
  const existing = await repo.getModuleById(id);
  if (!existing) throw new ModuleNotFoundError(id);

  // The slug is not recomputed from the new name.
  const updated = await repo.updateModule(id, {
    name: input.name,
    pluralName: input.pluralName,
    description: input.description ?? null,
  });
  if (!updated) throw new ModuleNotFoundError(id);

  await auditService.record(auth, {
    action: "custom_module.updated",
    entityType: "custom_module",
    entityId: id,
    before: { name: existing.name },
    after: { name: updated.name },
  });
  return updated;
}

/** Off the nav, records kept. The reversible half, as insurers and procedures have. */
export async function setModuleActive(
  auth: AuthContext,
  id: string,
  isActive: boolean,
) {
  const updated = await repo.setModuleActive(id, isActive);
  if (!updated) throw new ModuleNotFoundError(id);

  await auditService.record(auth, {
    action: isActive ? "custom_module.reactivated" : "custom_module.retired",
    entityType: "custom_module",
    entityId: id,
    after: { name: updated.name },
  });
  return updated;
}

/** Only ever removes an empty module. */
export async function deleteModule(auth: AuthContext, id: string) {
  const existing = await repo.getModuleById(id);
  if (!existing) throw new ModuleNotFoundError(id);

  const records = await repo.recordCount(id);
  if (records > 0) throw new ModuleInUseError(records);

  await repo.deleteModule(id);
  await auditService.record(auth, {
    action: "custom_module.deleted",
    entityType: "custom_module",
    entityId: id,
    before: { name: existing.name },
  });
}

export async function addField(
  auth: AuthContext,
  slug: string,
  input: CustomFieldInput,
) {
  const module = await repo.getModuleBySlug(slug);
  if (!module) throw new ModuleNotFoundError(slug);

  const fieldKey = slugify(input.label).replace(/-/g, "_");
  if (!fieldKey) throw new DuplicateFieldError(input.label);
  if (await repo.findFieldKey(module.id, fieldKey)) {
    throw new DuplicateFieldError(input.label);
  }

  const created = await repo.createField({
    moduleId: module.id,
    fieldKey,
    label: input.label,
    fieldType: input.fieldType,
    required: input.required,
    options: takesOptions(input.fieldType) ? (input.options ?? []) : null,
    helpText: input.helpText ?? null,
    showInList: input.showInList,
    sortOrder: await repo.nextFieldOrder(module.id),
  });
  if (!created) throw new Error("failed to create field");

  await auditService.record(auth, {
    action: "custom_module.field_added",
    entityType: "custom_module",
    entityId: module.id,
    after: { fieldKey, label: input.label, fieldType: input.fieldType },
  });
  return created;
}

export async function removeField(
  auth: AuthContext,
  slug: string,
  fieldId: string,
) {
  const module = await repo.getModuleBySlug(slug);
  if (!module) throw new ModuleNotFoundError(slug);

  const removed = await repo.deleteField(module.id, fieldId);
  if (!removed) throw new FieldNotFoundError(fieldId);

  // The column is gone, so its answers go too — see the repository.
  await repo.pruneFieldFromRecords(module.id, removed.fieldKey);

  await auditService.record(auth, {
    action: "custom_module.field_removed",
    entityType: "custom_module",
    entityId: module.id,
    before: { fieldKey: removed.fieldKey, label: removed.label },
  });
}

// --- records ---

export async function listRecords(slug: string, limit = 200) {
  const module = await getModule(slug);
  const rows = await repo.listRecords(module.id, limit);
  return { module, records: rows };
}

/** Validated against the module's own fields — the same check the form runs. */
async function checked(slug: string, data: Record<string, string>) {
  const module = await getModule(slug);
  const errors = validateRecord(module.fields, data);
  if (errors.length > 0) throw new RecordInvalidError(errors);
  return { module, data: pruneToFields(module.fields, data) };
}

export async function createRecord(
  auth: AuthContext,
  slug: string,
  input: Record<string, string>,
) {
  const { module, data } = await checked(slug, input);
  const memberId = await getMemberId(auth.userId);

  const created = await repo.createRecord(module.id, data, memberId);
  if (!created) throw new ModuleNotFoundError(slug);

  await auditService.record(auth, {
    action: "custom_record.created",
    entityType: "custom_record",
    entityId: created.id,
    after: { module: module.slug },
    actorId: memberId,
  });
  return created;
}

export async function updateRecord(
  auth: AuthContext,
  slug: string,
  recordId: string,
  input: Record<string, string>,
) {
  const { module, data } = await checked(slug, input);

  const updated = await repo.updateRecord(module.id, recordId, data);
  if (!updated) throw new RecordNotFoundError(recordId);

  await auditService.record(auth, {
    action: "custom_record.updated",
    entityType: "custom_record",
    entityId: recordId,
    after: { module: module.slug },
  });
  return updated;
}

export async function deleteRecord(
  auth: AuthContext,
  slug: string,
  recordId: string,
) {
  const module = await getModule(slug);
  const removed = await repo.deleteRecord(module.id, recordId);
  if (!removed) throw new RecordNotFoundError(recordId);

  await auditService.record(auth, {
    action: "custom_record.deleted",
    entityType: "custom_record",
    entityId: recordId,
    before: { module: module.slug },
  });
}
