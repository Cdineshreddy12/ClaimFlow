import { LayoutFieldType } from "@claimflow/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as service from "./preauth-layouts.service.js";
import {
  LayoutNotFoundError,
  AlreadyCustomisedError,
  StandardFieldError,
} from "./preauth-layouts.service.js";

const IdParams = z.object({ id: z.string().uuid() });
const LayoutQuery = z.object({ insurerId: z.string().uuid().optional() });
const InsurerBody = z.object({ insurerId: z.string().uuid() });
const InsurerParams = z.object({ insurerId: z.string().uuid() });

const SectionBody = z.object({
  layoutId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  displayOrder: z.number().int().min(0).default(0),
});

const PlacementBody = z.object({
  sectionId: z.string().uuid(),
  fieldDefinitionId: z.string().uuid(),
  displayOrder: z.number().int().min(0).default(0),
  columnPosition: z.number().int().min(0).max(1).default(0),
});

const PlacementPatch = z.object({
  labelOverride: z.string().trim().max(160).nullable().optional(),
  required: z.boolean().optional(),
});

const ReorderBody = z.object({
  order: z.array(
    z.object({
      id: z.string().uuid(),
      sectionId: z.string().uuid(),
      displayOrder: z.number().int().min(0),
      columnPosition: z.number().int().min(0).max(1).optional(),
    }),
  ),
});

const ReorderSectionsBody = z.object({
  order: z.array(
    z.object({
      id: z.string().uuid(),
      displayOrder: z.number().int().min(0),
    }),
  ),
});

const CustomFieldBody = z.object({
  // Lower snake_case: it becomes a storage key, and a key with spaces or
  // casing drift is a bug waiting to happen in the PDF and the extractor
  // prompt alike.
  fieldKey: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-zA-Z0-9]*$/, "Use camelCase letters and digits"),
  label: z.string().trim().min(1).max(160),
  // From the shared registry, never a second copy — a hardcoded list
  // here silently rejected "file" after the registry gained it.
  fieldType: LayoutFieldType,
  hint: z.string().trim().max(200).nullable().optional(),
  options: z
    .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
    .nullable()
    .optional(),
});

/** The form builder. */
export async function registerPreauthLayoutRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const { insurerId } = LayoutQuery.parse(request.query);
    return reply.send(await service.getLayout(insurerId ?? null));
  });

  app.get("/fields", async (_request, reply) =>
    reply.send(await service.listDefinitions()),
  );

  const admin = { preHandler: requireRole("org_admin", "desk_head") };

  app.post("/fields", admin, async (request, reply) => {
    const body = CustomFieldBody.parse(request.body);
    try {
      return reply
        .code(201)
        .send(await service.createCustomField(request.authUser!, body));
    } catch (err) {
      if (err instanceof StandardFieldError) {
        return reply.code(409).send({ error: "a field already uses that key" });
      }
      throw err;
    }
  });

  app.delete("/fields/:id", admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    try {
      await service.deleteCustomField(request.authUser!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof StandardFieldError) {
        return reply.code(409).send({
          error:
            "that's a standard IRDAI field — take it off the layout instead of deleting it",
        });
      }
      if (err instanceof LayoutNotFoundError) {
        return reply.code(404).send({ error: "field not found" });
      }
      throw err;
    }
  });

  /** Gives one insurer a form of their own, cloned from what they use today. */
  app.post("/for-insurer", admin, async (request, reply) => {
    const { insurerId } = InsurerBody.parse(request.body);
    try {
      return reply
        .code(201)
        .send(await service.customiseForInsurer(request.authUser!, insurerId));
    } catch (err) {
      if (err instanceof AlreadyCustomisedError) {
        return reply
          .code(409)
          .send({ error: "this insurer already has its own form" });
      }
      throw err;
    }
  });

  /** Drops it again; claims already opened keep the form they were sent on. */
  app.delete("/for-insurer/:insurerId", admin, async (request, reply) => {
    const { insurerId } = InsurerParams.parse(request.params);
    try {
      await service.revertToDefault(request.authUser!, insurerId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof LayoutNotFoundError) {
        return reply
          .code(404)
          .send({ error: "this insurer is already on the shared form" });
      }
      throw err;
    }
  });

  app.post("/sections", admin, async (request, reply) => {
    const body = SectionBody.parse(request.body);
    return reply
      .code(201)
      .send(
        await service.addSection(
          request.authUser!,
          body.layoutId,
          body.name,
          body.displayOrder,
        ),
      );
  });

  app.patch("/sections", admin, async (request, reply) => {
    const { order } = ReorderSectionsBody.parse(request.body);
    await service.reorderSections(order);
    return reply.code(204).send();
  });

  app.patch("/sections/:id", admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const { name } = z
      .object({ name: z.string().trim().min(1).max(120) })
      .parse(request.body);
    try {
      return reply.send(
        await service.renameSection(request.authUser!, id, name),
      );
    } catch (err) {
      if (err instanceof LayoutNotFoundError) {
        return reply.code(404).send({ error: "section not found" });
      }
      throw err;
    }
  });

  app.patch("/sections/:id/columns", admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const { columnCount } = z
      .object({ columnCount: z.number().int().min(1).max(2) })
      .parse(request.body);
    try {
      return reply.send(
        await service.setSectionColumns(request.authUser!, id, columnCount),
      );
    } catch (err) {
      if (err instanceof LayoutNotFoundError) {
        return reply.code(404).send({ error: "section not found" });
      }
      throw err;
    }
  });

  app.delete("/sections/:id", admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    try {
      await service.removeSection(request.authUser!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof LayoutNotFoundError) {
        return reply.code(404).send({ error: "section not found" });
      }
      throw err;
    }
  });

  app.post("/placements", admin, async (request, reply) => {
    const body = PlacementBody.parse(request.body);
    return reply
      .code(201)
      .send(
        await service.addField(
          request.authUser!,
          body.sectionId,
          body.fieldDefinitionId,
          body.displayOrder,
          body.columnPosition,
        ),
      );
  });

  app.patch("/placements/:id", admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const body = PlacementPatch.parse(request.body);
    try {
      return reply.send(
        await service.updatePlacement(request.authUser!, id, body),
      );
    } catch (err) {
      if (err instanceof LayoutNotFoundError) {
        return reply.code(404).send({ error: "field not found on this form" });
      }
      throw err;
    }
  });

  app.delete("/placements/:id", admin, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    try {
      await service.removeField(request.authUser!, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof LayoutNotFoundError) {
        return reply.code(404).send({ error: "field not found on this form" });
      }
      throw err;
    }
  });

  app.patch("/placements", admin, async (request, reply) => {
    const { order } = ReorderBody.parse(request.body);
    await service.reorder(order);
    return reply.code(204).send();
  });
}
