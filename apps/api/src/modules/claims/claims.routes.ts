import { ClaimListQuery, RecordPaymentBody } from "@claimflow/contracts";
import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as claimsService from "./claims.service.js";
import {
  ClaimIdParams,
  CreateClaimBody,
  ListClaimsQuery,
  UpdateClaimFinancialsBody,
  UpdateClaimStatusBody,
  AddChecklistSlotBody,
  RemoveChecklistSlotQuery,
} from "./claims.schema.js";
import {
  ClaimNotFoundError,
  OriginalSlotError,
  SlotInUseError,
  SlotNotOnClaimError,
  SlotAlreadyOnClaimError,
  NoRulesToApplyError,
  ChecklistAlreadySetError,
  InvalidTransitionError,
  PackageOnNonSchemeClaimError,
} from "./claims.service.js";

export async function registerClaimsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  /*
    Sends a page when asked for one, every match otherwise.

    The list screen always sends a limit; the dashboard's charts and
    the assistant's claim matching want the whole set and send none.
    One endpoint rather than two, because the filtering, the scoping
    and the search are identical either way — only the slice differs.
  */
  app.get("/", async (request, reply) => {
    const query = ListClaimsQuery.parse(request.query);
    const page = ClaimListQuery.parse(request.query);
    if (page.limit === undefined) {
      return reply.send(
        await claimsService.listClaims(request.authUser!, query),
      );
    }
    return reply.send(
      await claimsService.listClaimsPage(request.authUser!, {
        ...query,
        ...page,
      }),
    );
  });

  /*
    The dashboard, as six numbers rather than every claim.

    Declared before "/:id" so "overview" is never read as a claim id.
    Fastify matches static segments first regardless, but the order
    says the intent to whoever reads this next.
  */
  app.get("/overview", async (request, reply) => {
    return reply.send(await claimsService.getClaimOverview(request.authUser!));
  });

  app.get("/:id", async (request, reply) => {
    const { id } = ClaimIdParams.parse(request.params);
    try {
      const claim = await claimsService.getClaim(request.authUser!, id);
      return reply.send(claim);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  app.post("/", async (request, reply) => {
    const body = CreateClaimBody.parse(request.body);
    try {
      const claim = await claimsService.createClaim(request.authUser!, body);
      return reply.code(201).send(claim);
    } catch (err) {
      if (err instanceof PackageOnNonSchemeClaimError) {
        return reply.code(422).send({
          error: "a package rate belongs to a government scheme claim",
        });
      }
      throw err;
    }
  });

  /**
   * Adds one slot to one claim. Not a rule change: this touches the
   * claim's own snapshot and nothing else (docs/adr/0001's amendment).
   */
  app.post("/:id/checklist-slots", async (request, reply) => {
    const { id } = ClaimIdParams.parse(request.params);
    const body = AddChecklistSlotBody.parse(request.body);
    try {
      const claim = await claimsService.addChecklistSlot(
        request.authUser!,
        id,
        body.documentType,
        { required: body.required },
      );
      return reply.code(201).send(claim);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      if (err instanceof SlotAlreadyOnClaimError) {
        return reply
          .code(409)
          .send({ error: "that slot is already on this claim" });
      }
      throw err;
    }
  });

  /**
   * Removes a hand-added slot from one claim.
   *
   * The document type travels as a query parameter, not a path
   * segment: real slot names contain slashes ("Policy / e-card copy")
   * and would be read as extra path segments however they were
   * encoded.
   */
  app.delete("/:id/checklist-slots", async (request, reply) => {
    const { id } = ClaimIdParams.parse(request.params);
    const query = RemoveChecklistSlotQuery.parse(request.query);
    try {
      const claim = await claimsService.removeChecklistSlot(
        request.authUser!,
        id,
        query.documentType,
      );
      return reply.send(claim);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      if (err instanceof SlotNotOnClaimError) {
        return reply.code(404).send({ error: "that slot isn't on this claim" });
      }
      if (err instanceof OriginalSlotError) {
        return reply.code(422).send({
          error:
            "this slot came from the checklist the claim was opened against and can't be removed",
        });
      }
      if (err instanceof SlotInUseError) {
        return reply.code(409).send({
          error:
            "a confirmed document is filed in this slot — discard it first",
        });
      }
      throw err;
    }
  });

  /** Gives a claim opened with no checklist the one it should have had. */
  app.post("/:id/checklist-slots/apply-rules", async (request, reply) => {
    const { id } = ClaimIdParams.parse(request.params);
    try {
      const claim = await claimsService.applyCurrentRules(
        request.authUser!,
        id,
      );
      return reply.send(claim);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      if (err instanceof ChecklistAlreadySetError) {
        return reply.code(409).send({
          error:
            "this claim already has a checklist — rule changes never reach back into one",
        });
      }
      if (err instanceof NoRulesToApplyError) {
        return reply.code(422).send({
          error:
            "there are still no rules for this insurer and procedure — add them in Checklist Admin first",
        });
      }
      throw err;
    }
  });

  app.get("/:id/gaps", async (request, reply) => {
    const { id } = ClaimIdParams.parse(request.params);
    try {
      const gaps = await claimsService.getClaimGaps(request.authUser!, id);
      return reply.send(gaps);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  app.get("/:id/financials", async (request, reply) => {
    const { id } = ClaimIdParams.parse(request.params);
    try {
      return reply.send(
        await claimsService.getClaimFinancials(request.authUser!, id),
      );
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  /**
   * The sanctioned amount decides whether the hospital is owed money,
   * so it's a desk-head fact — same reasoning as recording a deduction.
   */
  app.patch(
    "/:id/financials",
    { preHandler: requireRole("org_admin", "desk_head") },
    async (request, reply) => {
      const { id } = ClaimIdParams.parse(request.params);
      const body = UpdateClaimFinancialsBody.parse(request.body);
      try {
        // Spread rather than pass-through: exactOptionalPropertyTypes
        // distinguishes "absent" from "present and undefined", and zod's
        // optional() produces the latter.
        return reply.send(
          await claimsService.updateClaimFinancials(request.authUser!, id, {
            ...(body.sanctionedAmount !== undefined
              ? { sanctionedAmount: body.sanctionedAmount }
              : {}),
            ...(body.billedAmount !== undefined
              ? { billedAmount: body.billedAmount }
              : {}),
          }),
        );
      } catch (err) {
        if (err instanceof ClaimNotFoundError) {
          return reply.code(404).send({ error: "claim not found" });
        }
        throw err;
      }
    },
  );

  app.patch("/:id/status", async (request, reply) => {
    const { id } = ClaimIdParams.parse(request.params);
    const body = UpdateClaimStatusBody.parse(request.body);
    try {
      const claim = await claimsService.transitionClaimStatus(
        request.authUser!,
        id,
        body.status,
        body.slaDeadline,
      );
      return reply.send(claim);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      if (err instanceof InvalidTransitionError) {
        return reply.code(422).send({ error: err.message });
      }
      throw err;
    }
  });

  /** What the insurer actually paid, as distinct from what they sanctioned. */
  app.patch("/:id/payment", async (request, reply) => {
    const { id } = ClaimIdParams.parse(request.params);
    const body = RecordPaymentBody.parse(request.body);
    try {
      return reply.send(
        await claimsService.recordPayment(request.authUser!, id, body),
      );
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });
}
