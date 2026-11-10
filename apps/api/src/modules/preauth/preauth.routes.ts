import { ConfirmPreauthFieldBody } from "@claimflow/contracts";
import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate.js";
import { aiRateLimit } from "../../middleware/rate-limit.js";
import * as preauthLayoutsService from "../preauth-layouts/preauth-layouts.service.js";
import * as preauthService from "./preauth.service.js";
import {
  ClaimNotFoundError,
  ExtractionFailedError,
  InvalidFieldValueError,
  UnknownFieldError,
} from "./preauth.service.js";
import { ClaimIdParams, FieldKeyParams } from "./preauth.schema.js";

export async function registerPreauthRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    try {
      return reply.send(
        await preauthService.listFields(request.authUser!, claimId),
      );
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  /**
   * The pre-submission review. A POST because the clinical half costs a
   * model call, so it runs when the desk asks rather than on every
   * render of the claim file.
   */
  app.post("/review", aiRateLimit(), async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    try {
      return reply.send(
        await preauthService.reviewClaimForm(request.authUser!, claimId),
      );
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  app.post("/extract", aiRateLimit(), async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    try {
      return reply.send(
        await preauthService.extractFields(request.authUser!, claimId),
      );
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      if (err instanceof ExtractionFailedError) {
        // 502, not 500: the documents and the claim are fine, the read
        // of them didn't complete. Retrying is a reasonable next step.
        return reply
          .code(502)
          .send({ error: "couldn't read the documents — try again" });
      }
      throw err;
    }
  });

  app.patch("/:fieldKey", async (request, reply) => {
    const { claimId, fieldKey } = FieldKeyParams.parse(request.params);
    const body = ConfirmPreauthFieldBody.parse(request.body);
    try {
      return reply.send(
        await preauthService.confirmField(
          request.authUser!,
          claimId,
          fieldKey,
          body.value,
        ),
      );
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      if (err instanceof UnknownFieldError) {
        return reply.code(404).send({ error: "no such pre-auth field" });
      }
      if (err instanceof InvalidFieldValueError) {
        // The field's own type rejected it — the same gate the
        // extractor's answers go through (docs/adr/0005).
        return reply
          .code(400)
          .send({ error: "that value doesn't fit this field" });
      }
      throw err;
    }
  });

  app.delete("/:fieldKey", async (request, reply) => {
    const { claimId, fieldKey } = FieldKeyParams.parse(request.params);
    try {
      await preauthService.clearField(request.authUser!, claimId, fieldKey);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      if (err instanceof UnknownFieldError) {
        return reply.code(404).send({ error: "no such pre-auth field" });
      }
      throw err;
    }
  });

  /** The claim form itself, printable. The packet route next door merges the attachments. */
  app.get("/form.pdf", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    try {
      const { bytes, fileName } = await preauthService.renderPreauthForm(
        request.authUser!,
        claimId,
      );
      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `inline; filename="${fileName}"`)
        .send(Buffer.from(bytes));
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  /**
   * The form this claim was opened under — its frozen snapshot, not the
   * live layout. Editing the form must never change what an in-flight
   * claim asked for (docs/adr/0001).
   */
  app.get("/layout", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    try {
      return reply.send(await preauthLayoutsService.layoutForClaim(claimId));
    } catch {
      return reply.code(404).send({ error: "claim not found" });
    }
  });
}
