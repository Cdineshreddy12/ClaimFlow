import { config } from "dotenv";
config({ path: "../../.env" });
import jwt from "jsonwebtoken";

/**
 * DEV-ONLY. Signs with SUPABASE_JWT_SECRET, which for local dev is a
 * placeholder value, NOT the real Supabase project secret — see .env's
 * comment on that var. A token from this script will never be accepted
 * by anything other than a locally-running API using the same
 * placeholder secret (apps/api/src/lib/supabase-jwt.ts hard-rejects
 * HS256 in production).
 *
 * Usage: tsx scripts/mint-dev-token.ts <role> [userId]
 * The userId needs a matching `members` row with that role for the API
 * to accept requests — this script only signs the token, it doesn't
 * create the row.
 *
 * No-membership usage: tsx scripts/mint-dev-token.ts --no-member [userId]
 * Mints a token with no app_metadata at all — what a just-signed-up
 * user's token actually looks like before a `members` row exists for
 * them. Only accepted by authenticateUserOnly routes (docs/adr/0007);
 * everything else 403s it on purpose.
 */
const args = process.argv.slice(2);

function secretOrExit(): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    console.error("SUPABASE_JWT_SECRET is not set — see .env.example");
    process.exit(1);
  }
  return secret;
}

if (args[0] === "--no-member" || args[0] === "--no-org") {
  const userId = args[1] ?? crypto.randomUUID();
  console.log(jwt.sign({ sub: userId }, secretOrExit(), { expiresIn: "24h" }));
  process.exit(0);
}

const [role, userId = crypto.randomUUID()] = args;

if (!role) {
  console.error(
    "usage: tsx scripts/mint-dev-token.ts <role> [userId]\n" +
      "   or: tsx scripts/mint-dev-token.ts --no-member [userId]",
  );
  process.exit(1);
}

console.log(
  jwt.sign({ sub: userId, app_metadata: { role } }, secretOrExit(), {
    expiresIn: "24h",
  }),
);
