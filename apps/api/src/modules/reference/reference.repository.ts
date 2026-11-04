import { asc } from "drizzle-orm";
import { db } from "../../db/client.js";
import { insurers, procedures } from "../../db/schema.js";

/**
 * insurers and procedures are shared reference data, not tenant-scoped —
 * the same insurer is the same real-world entity for every hospital (see
 * docs/ARCHITECTURE.md "Tenancy"). That's why nothing here filters by
 * organizationId, unlike every other repository in this codebase.
 *
 * Read-only on purpose: checklist_rules are per-organization, but the
 * catalogue they point at is curated centrally so two hospitals can't
 * create rival "Company B" rows that make cross-tenant reporting
 * meaningless later.
 */

export async function listInsurers() {
  return db.select().from(insurers).orderBy(asc(insurers.name));
}

export async function listProcedures() {
  return db.select().from(procedures).orderBy(asc(procedures.name));
}
