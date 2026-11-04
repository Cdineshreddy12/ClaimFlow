import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as hospitalService from "./hospital.service.js";
import { HospitalNotFoundError } from "./hospital.service.js";
import { UpdateProfileBody } from "./hospital.schema.js";

export async function registerHospitalRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  /** Any member reads it — the shell shows the hospital's name on every screen. */
  app.get("/", async (_request, reply) => {
    try {
      return reply.send(await hospitalService.getHospital());
    } catch (err) {
      if (err instanceof HospitalNotFoundError) {
        return reply.code(404).send({ error: "hospital profile not set up" });
      }
      throw err;
    }
  });

  /** Only an admin edits the legal/registration details — this is what goes to insurers. */
  app.patch(
    "/profile",
    { preHandler: requireRole("org_admin") },
    async (request, reply) => {
      const body = UpdateProfileBody.parse(request.body);
      try {
        return reply.send(
          await hospitalService.updateProfile(request.authUser!, body),
        );
      } catch (err) {
        if (err instanceof HospitalNotFoundError) {
          return reply.code(404).send({ error: "hospital profile not set up" });
        }
        throw err;
      }
    },
  );
}
