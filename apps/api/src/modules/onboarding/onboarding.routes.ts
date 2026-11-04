import type { FastifyInstance } from "fastify";
import {
  authenticate,
  authenticateUserOnly,
  requireRole,
} from "../../middleware/authenticate.js";
import * as onboardingService from "./onboarding.service.js";
import {
  AlreadyOnboardedError,
  InviteAlreadyUsedError,
  InviteExpiredError,
  InviteNotFoundError,
} from "./onboarding.service.js";
import {
  CreateInviteBody,
  CreateOrganizationBody,
  InviteTokenParams,
} from "./onboarding.schema.js";

/** Org-less — the one place a just-signed-up user can reach before org_members exists for them. */
export async function registerOnboardingRoutes(app: FastifyInstance) {
  app.post(
    "/organizations",
    { preHandler: authenticateUserOnly },
    async (request, reply) => {
      const body = CreateOrganizationBody.parse(request.body);
      try {
        const result = await onboardingService.createOrganization(
          request.authUserId!,
          body.name,
        );
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof AlreadyOnboardedError) {
          return reply
            .code(409)
            .send({ error: "you already belong to an organization" });
        }
        throw err;
      }
    },
  );
}

export async function registerInvitesRoutes(app: FastifyInstance) {
  app.post(
    "/",
    { preHandler: [authenticate, requireRole("org_admin")] },
    async (request, reply) => {
      const body = CreateInviteBody.parse(request.body);
      const invite = await onboardingService.createInvite(
        request.authUser!,
        body.role,
      );
      return reply.code(201).send(invite);
    },
  );

  app.get(
    "/",
    { preHandler: [authenticate, requireRole("org_admin")] },
    async (request, reply) => {
      const result = await onboardingService.listInvites(request.authUser!);
      return reply.send(result);
    },
  );

  // No auth — an invitee hasn't signed in yet when they open this link.
  app.get("/:token", async (request, reply) => {
    const { token } = InviteTokenParams.parse(request.params);
    try {
      const preview = await onboardingService.previewInvite(token);
      return reply.send(preview);
    } catch (err) {
      if (err instanceof InviteNotFoundError) {
        return reply.code(404).send({ error: "invite not found" });
      }
      if (err instanceof InviteExpiredError) {
        return reply.code(410).send({ error: "invite expired" });
      }
      if (err instanceof InviteAlreadyUsedError) {
        return reply.code(410).send({ error: "invite already used" });
      }
      throw err;
    }
  });

  app.post(
    "/:token/accept",
    { preHandler: authenticateUserOnly },
    async (request, reply) => {
      const { token } = InviteTokenParams.parse(request.params);
      try {
        const member = await onboardingService.acceptInvite(
          token,
          request.authUserId!,
        );
        return reply.send(member);
      } catch (err) {
        if (err instanceof InviteNotFoundError) {
          return reply.code(404).send({ error: "invite not found" });
        }
        if (err instanceof InviteExpiredError) {
          return reply.code(410).send({ error: "invite expired" });
        }
        if (err instanceof InviteAlreadyUsedError) {
          return reply.code(410).send({ error: "invite already used" });
        }
        if (err instanceof AlreadyOnboardedError) {
          return reply
            .code(409)
            .send({ error: "you already belong to an organization" });
        }
        throw err;
      }
    },
  );
}
