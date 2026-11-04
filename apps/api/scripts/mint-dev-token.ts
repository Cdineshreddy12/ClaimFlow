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
 *
 * Org-less usage: tsx scripts/mint-dev-token.ts --no-org [userId]
 * Mints a token with no app_metadata at all — what a just-signed-up
 * user's token actually looks like before org_members exists for them.
 * Only accepted by authenticateUserOnly routes (see docs/adr/0007),
 * everything else will 403 it on purpose.
 */
const args = process.argv.slice(2);

if (args[0] === "--no-org") {
  const userId = args[1] ?? crypto.randomUUID();
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    console.error("SUPABASE_JWT_SECRET is not set — see .env.example");
    process.exit(1);
  }
  console.log(jwt.sign({ sub: userId }, secret, { expiresIn: "24h" }));
  process.exit(0);
}

const [organizationId, role, userId = crypto.randomUUID()] = args;

if (!organizationId || !role) {
  console.error(
    "usage: tsx scripts/mint-dev-token.ts <organizationId> <role> [userId]\n" +
      "   or: tsx scripts/mint-dev-token.ts --no-org [userId]",
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
