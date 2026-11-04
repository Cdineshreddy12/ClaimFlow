import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as organizationsService from "./organizations.service.js";
import { OrganizationNotFoundError } from "./organizations.service.js";
import { UpdateProfileBody } from "./organizations.schema.js";

export async function registerOrganizationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  /** Any org member reads their own org — the shell shows its name on every screen. */
  app.get("/me", async (request, reply) => {
    try {
      const organization = await organizationsService.getOrganization(
        request.authUser!.organizationId,
      );
      return reply.send(organization);
    } catch (err) {
      if (err instanceof OrganizationNotFoundError) {
        return reply.code(404).send({ error: "organization not found" });
      }
      throw err;
    }
  });

  /** Only org_admin edits the hospital's legal/registration details — this is the data that goes to insurers. */
  app.patch(
    "/me/profile",
    { preHandler: requireRole("org_admin") },
    async (request, reply) => {
      const body = UpdateProfileBody.parse(request.body);
      try {
        const organization = await organizationsService.updateProfile(
          request.authUser!,
          body,
        );
        return reply.send(organization);
      } catch (err) {
        if (err instanceof OrganizationNotFoundError) {
          return reply.code(404).send({ error: "organization not found" });
        }
        throw err;
      }
    },
  );
}
