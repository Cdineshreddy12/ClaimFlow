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
 * This is the ONLY place organization_id/role get trusted from — every
 * tenant-scoped route handler reads request.authUser, never the raw
 * token, and every tenant-scoped query filters by
 * request.authUser.organizationId explicitly (see docs/adr/0002 — RLS
 * does not protect this API, this check plus org_id filtering is the
 * real boundary).
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const payload = await verifyRequestToken(request);
  if (!payload) {
    return reply.code(401).send({ error: "unauthorized" });
  }

  const organizationId = payload.app_metadata?.organization_id;
  const roleResult = Role.safeParse(payload.app_metadata?.role);

  if (!organizationId || !roleResult.success) {
    // Token is validly signed but carries no org/role claims — either the
    // Custom Access Token hook isn't enabled yet (see migration 0002) or
    // this user has no org_members row. Either way, nothing to scope to.
    return reply
      .code(403)
      .send({ error: "no organization membership on this token" });
  }

  request.authUser = {
    userId: payload.sub,
    organizationId,
    role: roleResult.data,
  };
}

/**
 * Verifies the token but does NOT require org/role claims — the one
 * exception to `authenticate`'s rule, for the handful of onboarding
 * routes a just-signed-up user has to be able to reach before
 * `org_members` exists for them at all. See docs/adr/0007.
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
