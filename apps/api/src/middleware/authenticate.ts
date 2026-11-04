import type { FastifyReply, FastifyRequest } from "fastify";
import { Role } from "@claimflow/contracts";
import {
  extractBearerToken,
  verifySupabaseToken,
  type SupabaseJwtPayload,
} from "../lib/supabase-jwt.js";

async function verifyRequestToken(
  request: FastifyRequest,
): Promise<SupabaseJwtPayload | null> {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) return null;
  try {
    return await verifySupabaseToken(token);
  } catch {
    return null;
  }
}

/**
 * Verifies the request's bearer token and populates request.authUser.
 *
 * This is the ONLY place the role claim gets trusted from — route
 * handlers read request.authUser, never the raw token. Since the
 * single-tenant change there is no scope to filter by, so role is the
 * whole of authorization and `requireRole` below is the real boundary
 * (docs/adr/0002 — RLS does not protect this API).
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const payload = await verifyRequestToken(request);
  if (!payload) {
    return reply.code(401).send({ error: "unauthorized" });
  }

  const roleResult = Role.safeParse(payload.app_metadata?.role);

  if (!roleResult.success) {
    // Validly signed but carries no role — either the Custom Access
    // Token hook isn't enabled (see migrations 0002 and 0014) or this
    // user has no `members` row yet. Either way there's nothing to
    // authorize against.
    return reply.code(403).send({ error: "no desk membership on this token" });
  }

  request.authUser = { userId: payload.sub, role: roleResult.data };
}

/**
 * Verifies the token but does NOT require a role claim — the one
 * exception to `authenticate`'s rule, for the handful of onboarding
 * routes a just-signed-up user has to reach before a `members` row
 * exists for them at all. See docs/adr/0007.
 */
export async function authenticateUserOnly(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const payload = await verifyRequestToken(request);
  if (!payload) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  request.authUserId = payload.sub;
}

/** Gate a route to specific roles, after `authenticate` has already run. */
export function requireRole(...roles: Role[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.authUser || !roles.includes(request.authUser.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  };
}
