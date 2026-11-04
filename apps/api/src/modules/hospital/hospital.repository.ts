import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { organizations } from "../../db/schema.js";

export async function getById(organizationId: string) {
  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return organization;
}

type OrganizationPatch = Partial<typeof organizations.$inferInsert>;

export async function updateProfile(
  organizationId: string,
  patch: OrganizationPatch,
) {
  const [updated] = await db
    .update(organizations)
    .set(patch)
    .where(eq(organizations.id, organizationId))
    .returning();
  return updated;
}
