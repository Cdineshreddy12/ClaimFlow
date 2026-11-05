import type { InsurerInput } from "@claimflow/contracts";
import * as auditService from "../audit/audit.service.js";
import * as repo from "./insurers.repository.js";

export class InsurerNotFoundError extends Error {}
export class DuplicateInsurerError extends Error {}
export class InsurerInUseError extends Error {
  constructor(public readonly usage: number) {
    super(`insurer is referenced by ${usage} records`);
  }
}

interface AuthContext {
  userId: string;
}

export function listInsurers(includeInactive = false) {
  return repo.list(includeInactive);
}

function fields(input: InsurerInput) {
  return {
    name: input.name,
    type: input.type,
    code: input.code ? input.code : null,
    contactEmail: input.contactEmail ? input.contactEmail : null,
  };
}

export async function createInsurer(auth: AuthContext, input: InsurerInput) {
  if (await repo.findByName(input.name)) {
    throw new DuplicateInsurerError(input.name);
  }
  const created = await repo.create(fields(input));
  if (!created) throw new Error("failed to create insurer");

  await auditService.record(auth, {
    action: "insurer.created",
    entityType: "insurer",
    entityId: created.id,
    after: { name: created.name, type: created.type },
  });
  return created;
}

export async function updateInsurer(
  auth: AuthContext,
  id: string,
  input: InsurerInput,
) {
  const existing = await repo.getById(id);
  if (!existing) throw new InsurerNotFoundError(id);
  if (await repo.findByName(input.name, id)) {
    throw new DuplicateInsurerError(input.name);
  }

  const updated = await repo.update(id, fields(input));
  if (!updated) throw new InsurerNotFoundError(id);

  await auditService.record(auth, {
    action: "insurer.updated",
    entityType: "insurer",
    entityId: id,
    before: { name: existing.name, type: existing.type },
    after: { name: updated.name, type: updated.type },
  });
  return updated;
}

/**
 * Retiring, not deleting. Claims already filed keep the insurer they
 * were filed under; it just stops being offered on new ones.
 */
export async function setInsurerActive(
  auth: AuthContext,
  id: string,
  isActive: boolean,
) {
  const updated = await repo.setActive(id, isActive);
  if (!updated) throw new InsurerNotFoundError(id);

  await auditService.record(auth, {
    action: isActive ? "insurer.reactivated" : "insurer.retired",
    entityType: "insurer",
    entityId: id,
    after: { name: updated.name },
  });
  return updated;
}

/**
 * Only ever possible for one created by mistake. The moment a claim or
 * a checklist rule points at it, deleting would strand them, so this
 * refuses and the caller is told to retire it instead.
 */
export async function deleteInsurer(auth: AuthContext, id: string) {
  const existing = await repo.getById(id);
  if (!existing) throw new InsurerNotFoundError(id);

  const usage = await repo.usageCount(id);
  if (usage > 0) throw new InsurerInUseError(usage);

  await repo.remove(id);
  await auditService.record(auth, {
    action: "insurer.deleted",
    entityType: "insurer",
    entityId: id,
    before: { name: existing.name, type: existing.type },
  });
}
