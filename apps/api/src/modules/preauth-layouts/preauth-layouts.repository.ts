import { asc, eq, isNull } from "drizzle-orm";
import type { PreauthLayout } from "@claimflow/contracts";
import { db } from "../../db/client.js";
import {
  preauthFieldDefinitions,
  preauthLayouts,
  preauthPlacements,
  preauthSections,
} from "../../db/schema.js";

export async function listDefinitions() {
  return db
    .select()
    .from(preauthFieldDefinitions)
    .orderBy(asc(preauthFieldDefinitions.label));
}

export async function getDefinitionByKey(fieldKey: string) {
  const [row] = await db
    .select()
    .from(preauthFieldDefinitions)
    .where(eq(preauthFieldDefinitions.fieldKey, fieldKey));
  return row;
}

type DefinitionInsert = typeof preauthFieldDefinitions.$inferInsert;

export async function createDefinition(values: DefinitionInsert) {
  const [row] = await db
    .insert(preauthFieldDefinitions)
    .values(values)
    .returning();
  return row;
}

/** The 24 IRDAI definitions go in together or not at all — see ensureSeeded. */
export async function createDefinitions(rows: DefinitionInsert[]) {
  if (rows.length === 0) return [];
  return db.insert(preauthFieldDefinitions).values(rows).returning();
}

export async function updateDefinition(
  id: string,
  values: Partial<DefinitionInsert>,
) {
  const [row] = await db
    .update(preauthFieldDefinitions)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(preauthFieldDefinitions.id, id))
    .returning();
  return row;
}

export async function deleteDefinition(id: string) {
  const [row] = await db
    .delete(preauthFieldDefinitions)
    .where(eq(preauthFieldDefinitions.id, id))
    .returning();
  return row;
}

export async function listLayouts() {
  return db.select().from(preauthLayouts).orderBy(asc(preauthLayouts.name));
}

/**
 * The layout an insurer should use: their own if they have one, the
 * fallback otherwise. Null when neither exists, which means the install
 * has never been seeded.
 */
export async function findLayoutRow(insurerId: string | null) {
  if (insurerId) {
    const [own] = await db
      .select()
      .from(preauthLayouts)
      .where(eq(preauthLayouts.insurerId, insurerId));
    if (own) return own;
  }
  const [fallback] = await db
    .select()
    .from(preauthLayouts)
    .where(isNull(preauthLayouts.insurerId));
  return fallback;
}

/**
 * Assembles a whole layout in one go.
 *
 * Three queries and a join in memory rather than a nested select: the
 * shape is a tree, and reconstructing it here keeps the ordering rules
 * in one readable place.
 */
export async function hydrate(
  layoutId: string,
): Promise<PreauthLayout | undefined> {
  const [layout] = await db
    .select()
    .from(preauthLayouts)
    .where(eq(preauthLayouts.id, layoutId));
  if (!layout) return undefined;

  const sections = await db
    .select()
    .from(preauthSections)
    .where(eq(preauthSections.layoutId, layoutId))
    .orderBy(asc(preauthSections.displayOrder));

  const placements = await db
    .select({
      placement: preauthPlacements,
      definition: preauthFieldDefinitions,
    })
    .from(preauthPlacements)
    .innerJoin(
      preauthFieldDefinitions,
      eq(preauthPlacements.fieldDefinitionId, preauthFieldDefinitions.id),
    )
    // Column second, and it matters: displayOrder restarts in each
    // column, so ordering on it alone leaves every field tied with its
    // neighbour across the columns and Postgres free to return them
    // either way round.
    .orderBy(
      asc(preauthPlacements.displayOrder),
      asc(preauthPlacements.columnPosition),
    );

  const bySection = new Map<string, typeof placements>();
  for (const row of placements) {
    const list = bySection.get(row.placement.sectionId) ?? [];
    list.push(row);
    bySection.set(row.placement.sectionId, list);
  }

  return {
    id: layout.id,
    name: layout.name,
    insurerId: layout.insurerId,
    sections: sections.map((section) => ({
      id: section.id,
      name: section.name,
      displayOrder: section.displayOrder,
      columnCount: section.columnCount,
      placements: (bySection.get(section.id) ?? []).map(
        ({ placement, definition }) => ({
          id: placement.id,
          displayOrder: placement.displayOrder,
          columnPosition: placement.columnPosition,
          labelOverride: placement.labelOverride,
          required: placement.required,
          definition: {
            id: definition.id,
            fieldKey: definition.fieldKey,
            label: definition.label,
            fieldType:
              definition.fieldType as PreauthLayout["sections"][number]["placements"][number]["definition"]["fieldType"],
            hint: definition.hint,
            options: definition.options ?? null,
            isStandard: definition.isStandard,
            conditionalOn: definition.conditionalOn ?? null,
          },
        }),
      ),
    })),
  };
}

export async function createLayout(name: string, insurerId: string | null) {
  const [row] = await db
    .insert(preauthLayouts)
    .values({ name, insurerId })
    .returning();
  return row;
}

export async function deleteLayout(id: string) {
  const [deleted] = await db
    .delete(preauthLayouts)
    .where(eq(preauthLayouts.id, id))
    .returning();
  return deleted;
}

export async function createSection(
  layoutId: string,
  name: string,
  displayOrder: number,
) {
  const [row] = await db
    .insert(preauthSections)
    .values({ layoutId, name, displayOrder })
    .returning();
  return row;
}

/**
 * Every section of a cloned layout in one statement.
 *
 * Cloning the shared form into an insurer's own used to insert these a
 * row at a time — three sections, three column updates and
 * twenty-five placements, each its own round trip to a Postgres that
 * is not on this machine. That is about thirty sequential trips, and
 * it took the endpoint fourteen seconds.
 */
export async function createSections(
  rows: {
    layoutId: string;
    name: string;
    displayOrder: number;
    columnCount: number;
  }[],
) {
  if (rows.length === 0) return [];
  return db.insert(preauthSections).values(rows).returning();
}

export async function renameSection(id: string, name: string) {
  const [row] = await db
    .update(preauthSections)
    .set({ name })
    .where(eq(preauthSections.id, id))
    .returning();
  return row;
}

export async function deleteSection(id: string) {
  const [row] = await db
    .delete(preauthSections)
    .where(eq(preauthSections.id, id))
    .returning();
  return row;
}

type PlacementInsert = typeof preauthPlacements.$inferInsert;

export async function createPlacement(values: PlacementInsert) {
  const [row] = await db.insert(preauthPlacements).values(values).returning();
  return row;
}

/** The matching bulk insert — see `createSections` for why. */
export async function createPlacements(rows: PlacementInsert[]) {
  if (rows.length === 0) return [];
  return db.insert(preauthPlacements).values(rows).returning();
}

export async function updatePlacement(
  id: string,
  values: Partial<PlacementInsert>,
) {
  const [row] = await db
    .update(preauthPlacements)
    .set(values)
    .where(eq(preauthPlacements.id, id))
    .returning();
  return row;
}

export async function deletePlacement(id: string) {
  const [row] = await db
    .delete(preauthPlacements)
    .where(eq(preauthPlacements.id, id))
    .returning();
  return row;
}

/** Applied as one transaction so a half-reordered form is never visible. */
export async function reorderPlacements(
  order: {
    id: string;
    sectionId: string;
    displayOrder: number;
    columnPosition?: number | undefined;
  }[],
) {
  await db.transaction(async (tx) => {
    for (const item of order) {
      await tx
        .update(preauthPlacements)
        .set({
          sectionId: item.sectionId,
          displayOrder: item.displayOrder,
          ...(item.columnPosition !== undefined
            ? { columnPosition: item.columnPosition }
            : {}),
        })
        .where(eq(preauthPlacements.id, item.id));
    }
  });
}

/** Applied as one transaction, same reasoning as reorderPlacements above. */
export async function reorderSections(
  order: { id: string; displayOrder: number }[],
) {
  await db.transaction(async (tx) => {
    for (const item of order) {
      await tx
        .update(preauthSections)
        .set({ displayOrder: item.displayOrder })
        .where(eq(preauthSections.id, item.id));
    }
  });
}

export async function setSectionColumns(id: string, columnCount: number) {
  const [row] = await db
    .update(preauthSections)
    .set({ columnCount })
    .where(eq(preauthSections.id, id))
    .returning();
  return row;
}
