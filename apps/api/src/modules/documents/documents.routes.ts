import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate.js";
import { aiRateLimit } from "../../middleware/rate-limit.js";
import * as documentsService from "./documents.service.js";
import {
  ClaimNotFoundError,
  DocumentAlreadyFiledError,
  DocumentNotFoundError,
  DocumentUnreadableError,
} from "./documents.service.js";
import {
  ClaimIdParams,
  ConfirmDocumentBody,
  DocumentIdParams,
  RegisterDocumentBody,
  RequestUploadUrlBody,
} from "./documents.schema.js";

export async function registerDocumentsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    try {
      const docs = await documentsService.listDocuments(
        request.authUser!,
        claimId,
      );
      return reply.send(docs);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  app.post("/upload-url", async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    const body = RequestUploadUrlBody.parse(request.body);
    const result = await documentsService.requestUploadUrl(
      request.authUser!,
      claimId,
      body,
    );
    return reply.send(result);
  });

  // Registering a document classifies it — a model call per upload.
  app.post("/", aiRateLimit(), async (request, reply) => {
    const { claimId } = ClaimIdParams.parse(request.params);
    const body = RegisterDocumentBody.parse(request.body);
    try {
      const document = await documentsService.registerDocument(
        request.authUser!,
        claimId,
        body.key,
        body.contentType,
      );
      return reply.code(201).send(document);
    } catch (err) {
      if (err instanceof ClaimNotFoundError) {
        return reply.code(404).send({ error: "claim not found" });
      }
      throw err;
    }
  });

  app.get("/:documentId/download-url", async (request, reply) => {
    const { claimId, documentId } = DocumentIdParams.parse(request.params);
    try {
      const downloadUrl = await documentsService.getDocumentDownloadUrl(
        request.authUser!,
        claimId,
        documentId,
      );
      return reply.send({ downloadUrl });
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return reply.code(404).send({ error: "document not found" });
      }
      throw err;
    }
  });

  app.patch("/:documentId/confirm", async (request, reply) => {
    const { claimId, documentId } = DocumentIdParams.parse(request.params);
    const body = ConfirmDocumentBody.parse(request.body);
    try {
      const document = await documentsService.confirmDocument(
        request.authUser!,
        claimId,
        documentId,
        body.checklistSlot,
      );
      return reply.send(document);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return reply.code(404).send({ error: "document not found" });
      }
      throw err;
    }
  });

  /** Read it again, against the checklist as it stands now. */
  app.post("/:documentId/reclassify", aiRateLimit(), async (request, reply) => {
    const { claimId, documentId } = DocumentIdParams.parse(request.params);
    try {
      const updated = await documentsService.reclassifyDocument(
        request.authUser!,
        claimId,
        documentId,
      );
      return reply.send(updated);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return reply.code(404).send({ error: "document not found" });
      }
      if (err instanceof DocumentAlreadyFiledError) {
        return reply
          .code(422)
          .send({ error: "this document is already filed" });
      }
      if (err instanceof DocumentUnreadableError) {
        return reply
          .code(422)
          .send({ error: "couldn't read this document — pick a slot by hand" });
      }
      throw err;
    }
  });

  app.delete("/:documentId", async (request, reply) => {
    const { claimId, documentId } = DocumentIdParams.parse(request.params);
    try {
      await documentsService.discardDocument(
        request.authUser!,
        claimId,
        documentId,
      );
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return reply.code(404).send({ error: "document not found" });
      }
      throw err;
    }
  });
}
