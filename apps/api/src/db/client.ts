import { config } from "dotenv";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// Self-sufficient on purpose: ES module imports are hoisted and run before
// any other top-level code in the importer, so a caller doing
// `import "dotenv/config"` then `import { db } from "./client.js"` would
// have this file's process.env read happen first anyway. Load here
// instead of relying on import order.
config({ path: "../../.env" });

// A single connection pool for the API process. This connects as the
// `postgres` superuser (see schema.ts header) — only ever call this from
// request handlers that have already enforced organization_id scoping in
// application code (RBAC), not from anywhere that assumes RLS applies.
//
// Lazy on purpose: throwing when DATABASE_URL is missing has to happen on
// first actual query, not on import. A static `import { db }` runs at
// module-load time regardless of any runtime guard around the code that
// uses it (e.g. vitest's describe.skipIf) — an eager throw here would
// crash test collection for every file that imports this module, even
// ones that never run a query, which is exactly what happened the first
// time this was written eagerly and verified against a real "no
// DATABASE_URL" run (CI doesn't have one configured).
let instance: PostgresJsDatabase<typeof schema> | undefined;

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!instance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — see .env.example");
    }
    instance = drizzle(
      postgres(connectionString, {
        prepare: false,
        /*
          postgres.js holds idle connections indefinitely and Supabase's
          pooler recycles them from its side, so a query can be written
          into a socket that died while idle and wait forever — no
          error, no timeout. These bound it: a stale connection costs
          one slow request, not the process.
        */
        idle_timeout: 20,
        max_lifetime: 60 * 30,
        connect_timeout: 10,
      }),
      { schema },
    );
  }
  return instance;
}

export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop, receiver) {
      return Reflect.get(getDb(), prop, receiver);
    },
  },
);
