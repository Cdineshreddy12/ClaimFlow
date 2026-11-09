import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { CustomFieldType } from "@claimflow/contracts";
import { db } from "../../db/client.js";
import {
  customModuleFields,
  customModuleRecords,
  customModules,
} from "../../db/schema.js";

/**
 * A module and its fields, in two queries rather than one per module.
 *
 * The same lesson the insurer and procedure masters learned the hard
 * way: a correlated subquery in the select silently returned 0 for
 * every row. Counts come from a grouped query joined in memory.
 */
export async function listModules(includeInactive = false) {
  const [modules, fields, counts] = await Promise.all([
    db
      .select()
      .from(customModules)
      .orderBy(asc(customModules.sortOrder), asc(customModules.name)),
    db
      .select()
      .from(customModuleFields)
      .orderBy(asc(customModuleFields.sortOrder)),
    db
      .select({ moduleId: customModuleRecords.moduleId, n: count() })
      .from(customModuleRecords)
      .groupBy(customModuleRecords.moduleId),
  ]);

  const fieldsBy = new Map<string, typeof fields>();
  for (const field of fields) {
    const list = fieldsBy.get(field.moduleId) ?? [];
    list.push(field);
    fieldsBy.set(field.moduleId, list);
  }
  const countsBy = new Map(counts.map((r) => [r.moduleId, r.n]));

  return modules
    .filter((m) => includeInactive || m.isActive)
    .map((m) => ({
      ...m,
      fields: (fieldsBy.get(m.id) ?? []).map(toField),
      recordCount: countsBy.get(m.id) ?? 0,
    }));
}

function toField(row: typeof customModuleFields.$inferSelect) {
  return { ...row, fieldType: row.fieldType as CustomFieldType };
}

export async function getModuleBySlug(slug: string) {
  const [module] = await db
    .select()
    .from(customModules)
    .where(eq(customModules.slug, slug))
    .limit(1);
  if (!module) return undefined;

  const fields = await db
    .select()
    .from(customModuleFields)
    .where(eq(customModuleFields.moduleId, module.id))
    .orderBy(asc(customModuleFields.sortOrder));

  return { ...module, fields: fields.map(toField) };
}

export async function getModuleById(id: string) {
  const [row] = await db
    .select()
    .from(customModules)
    .where(eq(customModules.id, id))
    .limit(1);
  return row;
}

/** Case-insensitive, so two spellings of one module can't both exist. */
export async function findBySlug(slug: string, exceptId?: string) {
  const rows = await db
    .select({ id: customModules.id })
    .from(customModules)
    .where(eq(customModules.slug, slug));
  return rows.find((r) => r.id !== exceptId);
}

export async function createModule(values: {
  name: string;
  pluralName: string;
  slug: string;
  description: string | null;
}) {
  const [row] = await db.insert(customModules).values(values).returning();
  return row;
}

export async function updateModule(
  id: string,
  values: {
    name: string;
    pluralName: string;
    description: string | null;
  },
) {
  const [row] = await db
    .update(customModules)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(customModules.id, id))
    .returning();
  return row;
}

export async function setModuleActive(id: string, isActive: boolean) {
  const [row] = await db
    .update(customModules)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(customModules.id, id))
    .returning();
  return row;
}

export async function deleteModule(id: string) {
  const [row] = await db
    .delete(customModules)
    .where(eq(customModules.id, id))
    .returning();
  return row;
}

export async function recordCount(moduleId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(customModuleRecords)
    .where(eq(customModuleRecords.moduleId, moduleId));
  return Number(row?.n ?? 0);
}

// --- fields ---

export async function findFieldKey(moduleId: string, fieldKey: string) {
  const [row] = await db
    .select({ id: customModuleFields.id })
    .from(customModuleFields)
    .where(
      and(
        eq(customModuleFields.moduleId, moduleId),
        eq(customModuleFields.fieldKey, fieldKey),
      ),
    )
    .limit(1);
  return row;
}

export async function createField(values: {
  moduleId: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  required: boolean;
  options: string[] | null;
  helpText: string | null;
  showInList: boolean;
  sortOrder: number;
}) {
  const [row] = await db.insert(customModuleFields).values(values).returning();
  return row ? toField(row) : undefined;
}

export async function nextFieldOrder(moduleId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(customModuleFields)
    .where(eq(customModuleFields.moduleId, moduleId));
  return Number(row?.n ?? 0);
}

export async function deleteField(moduleId: string, fieldId: string) {
  const [row] = await db
    .delete(customModuleFields)
    .where(
      and(
        eq(customModuleFields.id, fieldId),
        eq(customModuleFields.moduleId, moduleId),
      ),
    )
    .returning();
  return row;
}

// --- records ---

export async function listRecords(moduleId: string, limit: number) {
  return db
    .select()
    .from(customModuleRecords)
    .where(eq(customModuleRecords.moduleId, moduleId))
    .orderBy(desc(customModuleRecords.createdAt))
    .limit(limit);
}

export async function getRecord(moduleId: string, recordId: string) {
  const [row] = await db
    .select()
    .from(customModuleRecords)
    .where(
      and(
        eq(customModuleRecords.id, recordId),
        eq(customModuleRecords.moduleId, moduleId),
      ),
    )
    .limit(1);
  return row;
}

export async function createRecord(
  moduleId: string,
  data: Record<string, string>,
  createdBy: string | null,
) {
  const [row] = await db
    .insert(customModuleRecords)
    .values({ moduleId, data, createdBy })
    .returning();
  return row;
}

export async function updateRecord(
  moduleId: string,
  recordId: string,
  data: Record<string, string>,
) {
  const [row] = await db
    .update(customModuleRecords)
    .set({ data, updatedAt: new Date() })
    .where(
      and(
        eq(customModuleRecords.id, recordId),
        eq(customModuleRecords.moduleId, moduleId),
      ),
    )
    .returning();
  return row;
}

export async function deleteRecord(moduleId: string, recordId: string) {
  const [row] = await db
    .delete(customModuleRecords)
    .where(
      and(
        eq(customModuleRecords.id, recordId),
        eq(customModuleRecords.moduleId, moduleId),
      ),
    )
    .returning();
  return row;
}

/**
 * Drops a removed field's answers from every record on the module.
 *
 * Without this the data stays in the jsonb forever — invisible,
 * unexportable, and resurrected the day someone recreates a field with
 * the same key. Removing a column removes its answers.
 */
export async function pruneFieldFromRecords(
  moduleId: string,
  fieldKey: string,
) {
  await db
    .update(customModuleRecords)
    .set({ data: sql`${customModuleRecords.data} - ${fieldKey}` })
    .where(eq(customModuleRecords.moduleId, moduleId));
}
