import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { members } from "../../db/schema.js";

/**
 * Resolves a Supabase auth user id to their `members` row id.
 *
 * Needed because every "who did this" column — confirmedBy, actorId,
 * assignedTo, recordedBy — points at `members`, not at the Supabase
 * user. One install, one hospital, so the user id alone identifies the
 * row (docs/adr/0002).
 */
export async function getMemberId(userId: string): Promise<string | null> {
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.userId, userId));
  return member?.id ?? null;
}
