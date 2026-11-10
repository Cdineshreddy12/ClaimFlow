import { asc } from "drizzle-orm";
import { db } from "../../db/client.js";
import { insurers, procedures } from "../../db/schema.js";

/**
 * insurers and procedures are shared reference data, not tenant-scoped —
 * the same insurer is the same real-world entity for every hospital (see
 * docs/ARCHITECTURE.md "Tenancy").
 */

export async function listInsurers() {
  return db.select().from(insurers).orderBy(asc(insurers.name));
}

export async function listProcedures() {
  return db.select().from(procedures).orderBy(asc(procedures.name));
}
