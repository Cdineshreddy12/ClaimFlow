import {
  CustomFieldInput,
  CustomModuleInput,
  CustomRecordInput,
} from "@claimflow/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as service from "./custom-modules.service.js";
import {
  DuplicateFieldError,
  DuplicateModuleError,
  FieldNotFoundError,
  ModuleInUseError,
  ModuleNotFoundError,
  RecordInvalidError,
  RecordNotFoundError,
} from "./custom-modules.service.js";

const IdParams = z.object({ id: z.string().uuid() });
const SlugParams = z.object({ slug: z.string().min(1) });
const SlugFieldParams = z.object({
  slug: z.string().min(1),
  fieldId: z.string().uuid(),
});
const SlugRecordParams = z.object({
  slug: z.string().min(1),
  recordId: z.string().uuid(),
});
const SetActiveBody = z.object({ isActive: z.boolean() });
const ListQuery = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
});

/** Modules a hospital defines for itself. */
export async function registerCustomModulesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  const admin = { preHandler: requireRole("org_admin", "desk_head") };

  app.get("/", async (request, reply) => {
    const { includeInactive } = ListQuery.parse(request.query);
    return reply.send(await service.listModules(includeInactive === "true"));
  });

  app.post("/", admin, async (request, reply) => {
    const body = CustomModuleInput.parse(request.body);
    try {
      return reply
        .code(201)
        .send(await service.createModule(request.authUser!, body));
    } catch (err) {
      if (err instanceof DuplicateModuleError) {
        return reply
          .code(409)
          .send({ error: "A module with that name already exists" });
      }
      throw err;
    }
  });

  app.patch("/:id", admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const body = CustomModuleInput.parse(request.body);
    try {
      return reply.send(
        await service.updateModule(request.authUser!, id, body),
      );
    } catch (err) {
      if (replyForModuleError(err, reply)) return reply;
      throw err;
    }
  });

  app.patch("/:id/active", admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const { isActive } = SetActiveBody.parse(request.body);
    try {
      return reply.send(
        await service.setModuleActive(request.authUser!, id, isActive),
      );
    } catch (err) {
      if (replyForModuleError(err, reply)) return reply;
      throw err;
    }
  });

  app.delete("/:id", admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    try {
      await service.deleteModule(request.authUser!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ModuleInUseError) {
        // Says what stands in the way, because the answer is "hide it".
        return reply.code(409).send({
          error: `This module holds ${err.records} record(s) — hide it instead.`,
        });
      }
      if (replyForModuleError(err, reply)) return reply;
      throw err;
    }
  });

  app.get("/:slug", async (request, reply) => {
    const { slug } = SlugParams.parse(request.params);
    try {
      return reply.send(await service.getModule(slug));
    } catch (err) {
      if (replyForModuleError(err, reply)) return reply;
      throw err;
    }
  });

  // --- fields ---

  app.post("/:slug/fields", admin, async (request, reply) => {
    const { slug } = SlugParams.parse(request.params);
    const body = CustomFieldInput.parse(request.body);
    try {
      return reply
        .code(201)
        .send(await service.addField(request.authUser!, slug, body));
    } catch (err) {
      if (err instanceof DuplicateFieldError) {
        return reply
          .code(409)
          .send({ error: "A field with that name already exists here" });
      }
      if (replyForModuleError(err, reply)) return reply;
      throw err;
    }
  });

  app.delete("/:slug/fields/:fieldId", admin, async (request, reply) => {
    const { slug, fieldId } = SlugFieldParams.parse(request.params);
    try {
      await service.removeField(request.authUser!, slug, fieldId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof FieldNotFoundError) {
        return reply.code(404).send({ error: "field not found" });
      }
      if (replyForModuleError(err, reply)) return reply;
      throw err;
    }
  });

  // --- records: ordinary desk work, not administration ---

  app.get("/:slug/records", async (request, reply) => {
    const { slug } = SlugParams.parse(request.params);
    try {
      return reply.send(await service.listRecords(slug));
    } catch (err) {
      if (replyForModuleError(err, reply)) return reply;
      throw err;
    }
  });

  app.post("/:slug/records", async (request, reply) => {
    const { slug } = SlugParams.parse(request.params);
    const { data } = CustomRecordInput.parse(request.body);
    try {
      return reply
        .code(201)
        .send(await service.createRecord(request.authUser!, slug, data));
    } catch (err) {
      if (replyForRecordError(err, reply)) return reply;
      throw err;
    }
  });

  app.patch("/:slug/records/:recordId", async (request, reply) => {
    const { slug, recordId } = SlugRecordParams.parse(request.params);
    const { data } = CustomRecordInput.parse(request.body);
    try {
      return reply.send(
        await service.updateRecord(request.authUser!, slug, recordId, data),
      );
    } catch (err) {
      if (replyForRecordError(err, reply)) return reply;
      throw err;
    }
  });

  app.delete("/:slug/records/:recordId", async (request, reply) => {
    const { slug, recordId } = SlugRecordParams.parse(request.params);
    try {
      await service.deleteRecord(request.authUser!, slug, recordId);
      return reply.code(204).send();
    } catch (err) {
      if (replyForRecordError(err, reply)) return reply;
      throw err;
    }
  });
}

function replyForModuleError(err: unknown, reply: FastifyReply): boolean {
  if (err instanceof ModuleNotFoundError) {
    void reply.code(404).send({ error: "module not found" });
    return true;
  }
  return false;
}

function replyForRecordError(err: unknown, reply: FastifyReply): boolean {
  if (err instanceof RecordInvalidError) {
    // 422 with the per-field detail, not a flat 400.
    void reply.code(422).send({
      error: "Some answers don't match this module's fields",
      fields: err.errors,
    });
    return true;
  }
  if (err instanceof RecordNotFoundError) {
    void reply.code(404).send({ error: "record not found" });
    return true;
  }
  return replyForModuleError(err, reply);
}
