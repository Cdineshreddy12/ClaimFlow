import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// Self-sufficient on purpose: ES module imports are hoisted and run before
// any other top-level code in the importer, so a caller doing
// `import "dotenv/config"` then `import { db } from "./client.js"` would
// have this file's process.env read happen first anyway. Load here
// instead of relying on import order.
config({ path: "../../.env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see .env.example");
}

// A single connection pool for the API process. This connects as the
// `postgres` superuser (see schema.ts header) — only ever call this from
// request handlers that have already enforced organization_id scoping in
// application code (RBAC), not from anywhere that assumes RLS applies.
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
