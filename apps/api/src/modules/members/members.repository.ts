import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { orgMembers } from "../../db/schema.js";

/** Resolves a Supabase auth user id to their org_members row id within an org — see docs/adr/0002. */
export async function getOrgMemberId(
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const [member] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.organizationId, organizationId),
        eq(orgMembers.userId, userId),
      ),
    );
  return member?.id ?? null;
}
