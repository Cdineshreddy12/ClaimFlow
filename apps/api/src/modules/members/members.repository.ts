import { eq, sql } from "drizzle-orm";
import type { Role } from "@claimflow/contracts";
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

/** The caller's own membership row, or undefined if they have none yet. */
export async function getMemberByUserId(userId: string) {
  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.userId, userId));
  return member;
}

/** One membership by its own id — used to check an assignee exists before pointing a claim at them. */
export async function getMemberById(id: string) {
  const [member] = await db.select().from(members).where(eq(members.id, id));
  return member;
}

export interface RosterMember {
  /** The `members` row id — what `claims.assigned_to` points at. */
  id: string;
  role: Role;
  /** Null only if the auth user was deleted out from under the membership. */
  email: string | null;
}

/**
 * Everyone on the desk, for the assignee picker.
 *
 * The name has to come from `auth.users`, because `members` holds only
 * a role and a user id — Supabase owns the identity and this schema
 * deliberately does not duplicate it (see the comment on
 * `members.userId`). That table is in the same database and the API
 * connects as the owner, so this is a join rather than a second round
 * trip through the auth admin API, which would need the service-role
 * key this install does not set.
 *
 * Raw SQL for the same reason: `auth.users` is not in our Drizzle
 * schema and should not be, since we neither define nor migrate it.
 * Read-only, and only the two columns a picker needs.
 */
export async function listRoster(): Promise<RosterMember[]> {
  const rows = await db.execute(sql`
    select m.id, m.role, u.email
    from members m
    left join auth.users u on u.id = m.user_id
    order by u.email nulls last
  `);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    role: row.role as Role,
    email: (row.email as string | null) ?? null,
  }));
}
