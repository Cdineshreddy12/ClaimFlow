import type { FastifyInstance } from "fastify";
import {
  authenticate,
  authenticateUserOnly,
} from "../../middleware/authenticate.js";
import * as hospitalRepository from "../hospital/hospital.repository.js";
import { getMemberByUserId, listRoster } from "./members.repository.js";

/**
 * Who the caller is, according to the database.
 *
 * The role normally arrives as a JWT claim stamped by Supabase's Custom
 * Access Token hook, which is fast and needs no query — but that claim
 * is only written when a token is minted. A membership created after
 * that (accepting an invite in another tab, an admin granting a role,
 * a restored database) leaves the claim missing while the row plainly
 * exists, and the app concluded the user had no account at all.
 *
 * So the claim stays the fast path and this is the truth. Deliberately
 * behind `authenticateUserOnly`: requiring a role here to find out
 * whether you have a role is the circularity that caused the problem.
 */
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

/**
 * Everyone on the desk, for the assignee picker.
 *
 * Behind the full `authenticate`, unlike `/me` above — this one needs a
 * role, and the roles that may assign a claim are checked on the
 * assignment route itself. Reading who your colleagues are is not
 * privileged; deciding who works what is.
 */
export async function registerMembersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (_request, reply) => {
    return reply.send(await listRoster());
  });
}
