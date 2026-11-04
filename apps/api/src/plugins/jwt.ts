import fastifyJwt from "@fastify/jwt";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { Role } from "@claimflow/contracts";

/**
 * Registers @fastify/jwt against the Supabase project's JWT secret, so
 * request.jwtVerify() can check a Supabase-issued access token's
 * signature. Reading the custom claims it carries happens in
 * src/middleware/authenticate.ts, not here — this plugin only owns
 * "is this token genuinely from our Supabase project."
 */
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

export default fp(async function jwtPlugin(app: FastifyInstance) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error("SUPABASE_JWT_SECRET is not set — see .env.example");
  }
  await app.register(fastifyJwt, { secret });
});
