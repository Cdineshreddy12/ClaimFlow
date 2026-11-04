import { config } from "dotenv";
config({ path: "../../.env" });
import jwt from "jsonwebtoken";

/**
 * DEV-ONLY. There's no sign-up flow and the Supabase Custom Access Token
 * hook isn't enabled on the real project yet (docs/adr/0002) — this is
 * the only way to get a bearer token for local testing right now. Signs
 * with SUPABASE_JWT_SECRET, which for local dev is a placeholder value,
 * NOT the real Supabase project secret — see .env's comment on that var.
 * A token from this script will never be accepted by anything other than
 * a locally-running API using the same placeholder secret.
 *
 * Usage: tsx scripts/mint-dev-token.ts <organizationId> <role> [userId]
 * The organizationId must have a matching org_members row (with that
 * userId and role) for the API to accept requests — this script only
 * signs the token, it doesn't create that row.
 */
const [organizationId, role, userId = crypto.randomUUID()] =
  process.argv.slice(2);

if (!organizationId || !role) {
  console.error(
    "usage: tsx scripts/mint-dev-token.ts <organizationId> <role> [userId]",
  );
  process.exit(1);
}

const secret = process.env.SUPABASE_JWT_SECRET;
if (!secret) {
  console.error("SUPABASE_JWT_SECRET is not set — see .env.example");
  process.exit(1);
}

const token = jwt.sign(
  { sub: userId, app_metadata: { organization_id: organizationId, role } },
  secret,
  {
    expiresIn: "24h",
  },
);

console.log(token);
