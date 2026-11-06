import type { ProcedureInput } from "@claimflow/contracts";
import * as auditService from "../audit/audit.service.js";
import * as repo from "./procedures.repository.js";

export class ProcedureNotFoundError extends Error {}
export class DuplicateProcedureError extends Error {}
export class ProcedureInUseError extends Error {
  constructor(public readonly usage: { claims: number; rules: number }) {
    super(
      `procedure is referenced by ${usage.claims} claims and ${usage.rules} rules`,
    );
  }
}

interface AuthContext {
  userId: string;
}

export function listProcedures() {
  return repo.list();
}

function fields(input: ProcedureInput) {
  return { name: input.name, code: input.code ? input.code : null };
}

export async function createProcedure(
  auth: AuthContext,
  input: ProcedureInput,
) {
  // Case-insensitive, because two spellings of one procedure split its
  // checklist rules in half and neither claim gets the full list.
  if (await repo.findByName(input.name)) {
    throw new DuplicateProcedureError(input.name);
  }
  const created = await repo.create(fields(input));
  if (!created) throw new Error("failed to create procedure");

  await auditService.record(auth, {
    action: "procedure.created",
    entityType: "procedure",
    entityId: created.id,
    after: { name: created.name },
  });
  return created;
}

export async function updateProcedure(
  auth: AuthContext,
  id: string,
  input: ProcedureInput,
) {
  const existing = await repo.getById(id);
  if (!existing) throw new ProcedureNotFoundError(id);
  if (await repo.findByName(input.name, id)) {
    throw new DuplicateProcedureError(input.name);
  }

  const updated = await repo.update(id, fields(input));
  if (!updated) throw new ProcedureNotFoundError(id);

  await auditService.record(auth, {
    action: "procedure.updated",
    entityType: "procedure",
    entityId: id,
    before: { name: existing.name },
    after: { name: updated.name },
  });
  return updated;
}

/**
 * Only ever removes one nothing depends on.
 *
 * A procedure with claims against it cannot go: those claims were
 * opened under that name, and a checklist snapshot six weeks old has
 * to stay answerable. Renaming is the move for a procedure the
 * hospital has stopped doing — the claims keep their history and the
 * picker stops offering the old wording.
 */
export async function deleteProcedure(auth: AuthContext, id: string) {
  const existing = await repo.getById(id);
  if (!existing) throw new ProcedureNotFoundError(id);

  const usage = await repo.usage(id);
  if (usage.claims > 0 || usage.rules > 0) {
    throw new ProcedureInUseError(usage);
  }

  await repo.remove(id);
  await auditService.record(auth, {
    action: "procedure.deleted",
    entityType: "procedure",
    entityId: id,
    before: { name: existing.name },
  });
}
