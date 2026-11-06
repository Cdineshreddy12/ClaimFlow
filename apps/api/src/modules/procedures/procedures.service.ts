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

export function listProcedures(includeInactive = false) {
  return repo.list(includeInactive);
}

/**
 * Retiring, not deleting. Claims already opened keep the procedure they
 * were opened under; it just stops being offered on new ones.
 *
 * This is the operation a hospital actually needs on a list that lives
 * for years. Deleting is refused the moment a claim references the row,
 * so without this a procedure the hospital had stopped doing stayed in
 * the picker permanently.
 */
export async function setProcedureActive(
  auth: AuthContext,
  id: string,
  isActive: boolean,
) {
  const updated = await repo.setActive(id, isActive);
  if (!updated) throw new ProcedureNotFoundError(id);

  await auditService.record(auth, {
    action: isActive ? "procedure.reactivated" : "procedure.retired",
    entityType: "procedure",
    entityId: id,
    after: { name: updated.name },
  });
  return updated;
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
 * to stay answerable. Retiring is the move for a procedure the hospital
 * has stopped doing — the claims keep their history, the picker stops
 * offering it, and it can be put back.
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
