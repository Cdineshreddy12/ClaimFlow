import { db } from "../../db/client.js";
import { hospitalProfile } from "../../db/schema.js";

/**
 * The one hospital this install belongs to. A unique index on a constant
 * enforces the singleton in the database (migration 0014), so "the first
 * row" and "the only row" are the same thing.
 */
export async function get() {
  const [profile] = await db.select().from(hospitalProfile).limit(1);
  return profile;
}

type HospitalPatch = Partial<typeof hospitalProfile.$inferInsert>;

export async function create(name: string) {
  const [created] = await db
    .insert(hospitalProfile)
    .values({ name })
    .returning();
  return created;
}

export async function updateProfile(patch: HospitalPatch) {
  const existing = await get();
  if (!existing) return undefined;
  const [updated] = await db.update(hospitalProfile).set(patch).returning();
  return updated;
}
