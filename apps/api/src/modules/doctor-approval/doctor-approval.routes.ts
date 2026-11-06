import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import * as service from "./doctor-approval.service.js";
import {
  ClaimNotFoundError,
  LinkAlreadyDecidedError,
  LinkExpiredError,
  NothingToApproveError,
  LinkNotFoundError,
} from "./doctor-approval.service.js";

const ClaimIdParams = z.object({ claimId: z.string().uuid() });
const TokenParams = z.object({ token: z.string().uuid() });

const RequestApprovalBody = z.object({
  doctorName: z.string().trim().min(1, "Required").max(120),
});

const DecideBody = z.discriminatedUnion("approved", [
  z.object({ approved: z.literal(true) }),
  z.object({
    approved: z.literal(false),
    // Declining without saying why leaves the desk nothing to act on.
    reason: z.string().trim().min(1, "Say what needs changing").max(500),
  }),
]);

/** Nested under /claims/:claimId/doctor-approvals — desk side, authenticated. */
export async function registerClaimDoctorApprovalRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.post("/", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    const body = RequestApprovalBody.parse(request.body);
    try {
      const approval = await service.requestApproval(
        request.authUser!,
        claimId,
        body.doctorName,
      );
      return reply.code(201).send(approval);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  app.get("/", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    try {
      return reply.send(await service.listForClaim(request.authUser!, claimId));
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });
}

/** Shared by both public routes — an expired and an already-used link are both 410 Gone, not 404: the link was real, it just no longer works. */
function replyForLinkError(err: unknown, reply: FastifyReply): boolean {
  if (err instanceof LinkNotFoundError) {
    void reply.code(404).send({ error: "link not found" });
    return true;
  }
  if (err instanceof LinkExpiredError) {
    void reply.code(410).send({ error: "this link has expired" });
    return true;
  }
  if (err instanceof LinkAlreadyDecidedError) {
    void reply.code(410).send({ error: "this link has already been used" });
    return true;
  }
  if (err instanceof NothingToApproveError) {
    void reply.code(409).send({
      error: "no clinical notes are attached to this claim yet",
    });
    return true;
  }
  return false;
}

/**
 * Public — the doctor has no account, the token is the credential. See
 * docs/adr/0010 for why that trade is acceptable and what bounds it.
 */
export async function registerPublicDoctorApprovalRoutes(app: FastifyInstance) {
  app.get("/:token", async (request, reply) => {
    const { token } = TokenParams.parse(request.params);
    try {
      return reply.send(await service.viewByToken(token));
    } catch (err) {
      if (replyForLinkError(err, reply)) return reply;
      throw err;
    }
  });

  app.post("/:token/decide", async (request, reply) => {
    const { token } = TokenParams.parse(request.params);
    const body = DecideBody.parse(request.body);
    try {
      await service.decide(
        token,
        body.approved
          ? { approved: true }
          : { approved: false, reason: body.reason },
      );
      return reply.send({ ok: true });
    } catch (err) {
      if (replyForLinkError(err, reply)) return reply;
      throw err;
    }
  });
}
