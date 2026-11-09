import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

/**
 * Applies the SQL in `migrations/`, in order, once each.
 *
 * `drizzle-kit migrate` cannot do this here. It applies what is listed
 * in `meta/_journal.json`, and that journal stops at `0011` while the
 * directory goes to `0035` — everything from `0012_claim_preauth_fields`
 * onward was written and applied as raw SQL without a journal entry.
 * Pointed at an empty database it would build a schema missing half
 * the tables and report success, which is worse than refusing.
 *
 * Re-journaling those 24 would mean re-baselining drizzle's snapshots
 * too, and the snapshots are what `drizzle-kit generate` diffs against
 * to author the *next* migration. That is a bigger decision than
 * "deploy the thing". This runs the files the way they have actually
 * always been run — in filename order, which is numeric because every
 * name is zero-padded to four digits — and writes down which ones it
 * has run.
 *
 *     node dist/migrate.js              # apply what is outstanding
 *     node dist/migrate.js --baseline   # record all as applied, run none
 *     node dist/migrate.js --status     # say what would happen, change nothing
 *
 * `--baseline` is for the database that already has every one of these
 * applied by hand and no record of it. Running without it there would
 * try to create tables that exist.
 */

/** Its own table, so it cannot collide with drizzle's `__drizzle_migrations`. */
const TABLE = "_claimflow_migrations";

/** `/app/migrations` in the image, `src/db/migrations` in the repo. */
function resolveMigrationsDir(): string {
  const fromEnv = process.env.MIGRATIONS_DIR;
  const candidates = fromEnv
    ? [fromEnv]
    : ["./migrations", "./src/db/migrations", "./apps/api/src/db/migrations"];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(
    `No migrations directory found (looked in ${candidates.join(", ")}). ` +
      `Set MIGRATIONS_DIR.`,
  );
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex").slice(0, 16);
}

/**
 * Drizzle writes `--> statement-breakpoint` between statements; the
 * hand-written files have no marker and run whole. Splitting on the
 * marker rather than on `;` is what keeps a `$$ … $$` function body
 * — migration 0002's access-token hook — in one piece.
 */
function statementsIn(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main(): Promise<void> {
  // Present when run from a checkout, absent in the image, where the
  // configuration comes from the container's environment.
  config({ path: "../../.env" });
  config({ path: ".env" });

  const baseline = process.argv.includes("--baseline");
  const statusOnly = process.argv.includes("--status");

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — see .env.example");

  const dir = resolveMigrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) throw new Error(`No .sql files in ${dir}`);

  // One connection, and no prepared statements — the same setting the
  // app uses, so this works through Supabase's transaction-mode pooler
  // as well as a direct connection.
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    await sql.unsafe(`
      create table if not exists ${TABLE} (
        filename    text primary key,
        checksum    text        not null,
        applied_at  timestamptz not null default now()
      )
    `);

    const applied = new Map(
      (
        await sql.unsafe<{ filename: string; checksum: string }[]>(
          `select filename, checksum from ${TABLE}`,
        )
      ).map((r) => [r.filename, r.checksum]),
    );

    const outstanding = files.filter((f) => !applied.has(f));

    // A file edited after it ran means the database and the directory
    // disagree about what the schema is, and no amount of re-running
    // fixes that — so say so rather than carrying on.
    const drifted = files.filter((f) => {
      const was = applied.get(f);
      return (
        was !== undefined &&
        was !== checksum(readFileSync(join(dir, f), "utf8"))
      );
    });
    if (drifted.length > 0 && process.env.ALLOW_CHECKSUM_DRIFT !== "1") {
      throw new Error(
        `These have changed since they were applied: ${drifted.join(", ")}. ` +
          `The database no longer matches the directory. Set ` +
          `ALLOW_CHECKSUM_DRIFT=1 to record the new checksums and move on.`,
      );
    }

    console.log(`migrations: ${dir}`);
    console.log(`  ${files.length} on disk, ${applied.size} applied`);

    if (statusOnly) {
      console.log(
        outstanding.length === 0
          ? "  nothing outstanding"
          : `  outstanding:\n${outstanding.map((f) => `    ${f}`).join("\n")}`,
      );
      return;
    }

    if (baseline) {
      for (const file of outstanding) {
        const body = readFileSync(join(dir, file), "utf8");
        await sql.unsafe(
          `insert into ${TABLE} (filename, checksum) values ($1, $2)
           on conflict (filename) do nothing`,
          [file, checksum(body)],
        );
      }
      console.log(
        `  baselined ${outstanding.length} file(s) as applied without running them`,
      );
      return;
    }

    if (outstanding.length === 0) {
      console.log("  nothing to do");
      return;
    }

    for (const file of outstanding) {
      const body = readFileSync(join(dir, file), "utf8");
      process.stdout.write(`  applying ${file} … `);
      // One transaction per file: a migration that fails half-way
      // leaves nothing behind to clean up by hand.
      await sql.begin(async (tx) => {
        for (const statement of statementsIn(body)) {
          await tx.unsafe(statement);
        }
        await tx.unsafe(
          `insert into ${TABLE} (filename, checksum) values ($1, $2)`,
          [file, checksum(body)],
        );
      });
      console.log("ok");
    }
    console.log(`  applied ${outstanding.length} migration(s)`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(
    `\nmigration failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
