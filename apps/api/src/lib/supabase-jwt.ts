import { decodeProtectedHeader, createRemoteJWKSet, jwtVerify } from "jose";
import jwt from "jsonwebtoken";
import type { Role } from "@claimflow/contracts";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: {
      userId: string;
      organizationId: string;
      role: Role;
    };
    /**
     * Set by authenticateUserOnly (see middleware/authenticate.ts) for the
     * one sliver of routes a just-signed-up, org-less user can reach —
     * creating their organization or accepting an invite. Everywhere else
     * uses authUser instead, never this.
     */
    authUserId?: string;
  }
}

export interface SupabaseJwtPayload {
  sub: string;
  app_metadata?: {
    organization_id?: string;
    role?: string;
  };
}

/**
 * Real Supabase-issued tokens are ES256, signed against the project's own
 * key pair — verified here against Supabase's public JWKS, fetched lazily
 * and cached by `jose` (no secret to hold on our side at all for this
 * path). Resolved once per process, not per request.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks() {
  if (!jwks) {
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL is not set — see .env.example");
    }
    jwks = createRemoteJWKSet(
      new URL("/auth/v1/.well-known/jwks.json", supabaseUrl),
    );
  }
  return jwks;
}

/**
 * Locally-minted tokens (scripts/mint-dev-token.ts) are HS256, signed
 * against a placeholder shared secret — the only way to get a bearer
 * token without a real Supabase sign-in. Never accepted in production:
 * gating this path on NODE_ENV is the whole point, not a formality — an
 * HS256 token is trivially forgeable by anyone who's ever seen this
 * placeholder value, unlike the real ES256 path above.
 */
function verifyDevToken(token: string): SupabaseJwtPayload {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error("SUPABASE_JWT_SECRET is not set — see .env.example");
  }
  return jwt.verify(token, secret) as SupabaseJwtPayload;
}

/** Verifies a Supabase bearer token, real (ES256/JWKS) or local-dev (HS256), and returns its payload. Throws on anything invalid. */
export async function verifySupabaseToken(
  token: string,
): Promise<SupabaseJwtPayload> {
  const { alg } = decodeProtectedHeader(token);

  if (alg === "HS256") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("HS256 dev tokens are not accepted in production");
    }
    return verifyDevToken(token);
  }

  const { payload } = await jwtVerify(token, getJwks());
  return payload as SupabaseJwtPayload;
}

export function extractBearerToken(
  authorizationHeader?: string,
): string | null {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  return authorizationHeader.slice("Bearer ".length);
}
