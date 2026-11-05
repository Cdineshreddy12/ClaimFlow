import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import {
  ClaimNotFoundError,
  SlotAlreadyOnClaimError,
} from "../claims/claims.service.js";
import { QueryNotFoundError } from "../queries/queries.service.js";
import * as assistantService from "./assistant.service.js";
import {
  AlreadyFiledError,
  AssistantUnavailableError,
  AttachmentNotFoundError,
  ConversationNotFoundError,
  ForbiddenError,
  SlotNotOnClaimError,
} from "./assistant.service.js";
import {
  DuplicateRuleError,
  RuleNotFoundError,
} from "../checklist/checklist.service.js";
import {
  ApproveProposalBody,
  AttachmentIdParams,
  ChatBody,
  ConversationIdParams,
  RegisterAttachmentBody,
  RequestAttachmentUploadBody,
} from "./assistant.schema.js";

/** What the panel shows when a turn doesn't finish. */
function streamFailureMessage(err: unknown): string {
  if (err instanceof AssistantUnavailableError) return err.message;
  if (err instanceof AttachmentNotFoundError) {
    return "One of those files isn't there any more — try dropping it in again.";
  }
  if (err instanceof ConversationNotFoundError) {
    return "That conversation isn't available. Start a new one.";
  }
  return "Something went wrong. Try again.";
}

export async function registerAssistantRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  /** Whether the panel can do anything, so it can say so instead of failing on first use. */
  app.get("/status", async (_request, reply) =>
    reply.send({ available: assistantService.assistantAvailable() }),
  );

  app.get("/attachments", async (request, reply) => {
    const attachments = await assistantService.listPendingAttachments(
      request.authUser!,
    );
    return reply.send(attachments);
  });

  /** Step 1 of the same two-step upload documents use — the API never streams bytes. */
  app.post("/attachments/upload-url", async (request, reply) => {
    const body = RequestAttachmentUploadBody.parse(request.body);
    const result = await assistantService.requestAttachmentUpload(
      request.authUser!,
      body,
    );
    return reply.send(result);
  });

  app.post("/attachments", async (request, reply) => {
    const body = RegisterAttachmentBody.parse(request.body);
    const attachment = await assistantService.registerAttachment(
      request.authUser!,
      body,
    );
    return reply.code(201).send(attachment);
  });

  app.get("/attachments/:id/download-url", async (request, reply) => {
    const { id } = AttachmentIdParams.parse(request.params);
    try {
      return reply.send(
        await assistantService.getAttachmentDownloadUrl(request.authUser!, id),
      );
    } catch (err) {
      if (err instanceof AttachmentNotFoundError) {
        return reply.code(404).send({ error: "attachment not found" });
      }
      throw err;
    }
  });

  app.delete("/attachments/:id", async (request, reply) => {
    const { id } = AttachmentIdParams.parse(request.params);
    try {
      await assistantService.dismissAttachment(request.authUser!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof AttachmentNotFoundError) {
        return reply.code(404).send({ error: "attachment not found" });
      }
      throw err;
    }
  });

  app.get("/conversations", async (request, reply) =>
    reply.send(await assistantService.listConversations(request.authUser!)),
  );

  app.get("/conversations/:id", async (request, reply) => {
    const { id } = ConversationIdParams.parse(request.params);
    try {
      return reply.send(
        await assistantService.getConversation(request.authUser!, id),
      );
    } catch (err) {
      if (err instanceof ConversationNotFoundError) {
        return reply.code(404).send({ error: "conversation not found" });
      }
      throw err;
    }
  });

  app.delete("/conversations/:id", async (request, reply) => {
    const { id } = ConversationIdParams.parse(request.params);
    try {
      await assistantService.deleteConversation(request.authUser!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ConversationNotFoundError) {
        return reply.code(404).send({ error: "conversation not found" });
      }
      throw err;
    }
  });

  /**
   * One turn, streamed.
   *
   * Server-sent events rather than a JSON response, because the loop
   * can spend seconds reading claims before it has a word to say and
   * silence reads as broken. `text` deltas arrive as the model writes,
   * `tool` says what it is doing in between, and `done` carries the
   * parts that only exist once the turn is over — the proposals, and
   * the id to continue on.
   *
   * Errors ride the stream too. Once the headers are out a status code
   * is no longer available to say anything with, and failing silently
   * mid-sentence is the worst of the options.
   */
  app.post("/chat", async (request, reply) => {
    const body = ChatBody.parse(request.body);

    // Tells Fastify the socket is ours now, so it doesn't also try to
    // send a response.
    reply.hijack();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer by default, which would hold every
      // token back until the turn ended and undo the whole point.
      "X-Accel-Buffering": "no",
      // Writing to reply.raw skips the reply lifecycle, and with it
      // @fastify/cors — every other route gets these from the plugin,
      // this one has to say them itself or the browser drops the
      // response before a line of it is read. Mirrors the plugin's
      // `origin: true`, which reflects whatever asked.
      ...(request.headers.origin
        ? {
            "Access-Control-Allow-Origin": request.headers.origin,
            Vary: "Origin",
          }
        : {}),
    });

    const send = (event: string, data: unknown) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await assistantService.chat(
        request.authUser!,
        body,
        (event) => send(event.type, event),
      );
      send("done", result);
    } catch (err) {
      // A sentence, not err.message: the not-found errors carry only
      // the id they were thrown with, and a bare uuid in the panel
      // tells a desk nothing they can act on.
      send("failed", { error: streamFailureMessage(err) });
      if (
        !(err instanceof AssistantUnavailableError) &&
        !(err instanceof AttachmentNotFoundError) &&
        !(err instanceof ConversationNotFoundError)
      ) {
        request.log.error(err);
      }
    } finally {
      reply.raw.end();
    }
  });

  /**
   * The only place an assistant suggestion becomes a change.
   *
   * Everything here re-validates and then calls the same service a
   * button elsewhere in the app would, so the role checks and the audit
   * rows are not a second implementation that could drift from the
   * first.
   */
  app.post("/proposals/approve", async (request, reply) => {
    const body = ApproveProposalBody.parse(request.body);
    try {
      const result = await assistantService.approveProposal(
        request.authUser!,
        body,
      );
      return reply.send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        // The model proposed something malformed. A 400 with the field
        // names is more use to the desk than a 500.
        return reply
          .code(400)
          .send({ error: "that proposal was malformed", detail: err.issues });
      }
      if (err instanceof AttachmentNotFoundError) {
        return reply.code(404).send({ error: "attachment not found" });
      }
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      if (err instanceof QueryNotFoundError) {
        return reply.code(404).send({ error: "query not found" });
      }
      if (err instanceof ForbiddenError) {
        return reply.code(403).send({ error: err.message });
      }
      if (err instanceof DuplicateRuleError) {
        return reply.code(409).send({ error: err.message });
      }
      if (err instanceof RuleNotFoundError) {
        return reply.code(404).send({ error: "rule not found" });
      }
      if (err instanceof SlotAlreadyOnClaimError) {
        return reply
          .code(409)
          .send({ error: "that slot is already on this claim" });
      }
      if (err instanceof AlreadyFiledError) {
        return reply.code(409).send({ error: "that file was already filed" });
      }
      if (err instanceof SlotNotOnClaimError) {
        return reply
          .code(422)
          .send({ error: "that slot isn't on this claim's checklist" });
      }
      throw err;
    }
  });
}
