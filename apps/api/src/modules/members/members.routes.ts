import type { FastifyInstance } from "fastify";
import {
  authenticate,
  authenticateUserOnly,
} from "../../middleware/authenticate.js";
import * as hospitalRepository from "../hospital/hospital.repository.js";
import { getMemberByUserId, listRoster } from "./members.repository.js";

/** Who the caller is, according to the database. */
export async function registerMeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticateUserOnly);

  app.get("/", async (request, reply) => {
    const userId = request.authUserId!;
    const member = await getMemberByUserId(userId);
    const hospital = await hospitalRepository.get();

    return reply.send({
      userId,
      role: member?.role ?? null,
      memberId: member?.id ?? null,
      hospitalName: hospital?.name ?? null,
      /** False only on a brand-new install nobody has claimed. */
      hospitalExists: Boolean(hospital),
    });
  });
}

/** Everyone on the desk, for the assignee picker. */
export async function registerMembersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (_request, reply) => {
    return reply.send(await listRoster());
  });
}
