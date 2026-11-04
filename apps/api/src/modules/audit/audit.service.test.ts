import { beforeEach, describe, expect, it, vi } from "vitest";
import * as auditRepository from "./audit.repository.js";
import * as orgMembersRepository from "../org-members/org-members.repository.js";

vi.mock("./audit.repository.js");
vi.mock("../org-members/org-members.repository.js");

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const MEMBER_ID = "33333333-3333-3333-3333-333333333333";
const auth = { organizationId: ORG_ID, userId: USER_ID };

describe("audit.service.record", () => {
  beforeEach(() => {
    // resetAllMocks, not clearAllMocks — the failure test below replaces
    // insert's implementation with a rejection, and clearAllMocks only
    // wipes recorded calls, leaving that rejection in place for every
    // later test.
    vi.resetAllMocks();
    vi.mocked(orgMembersRepository.getOrgMemberId).mockResolvedValue(MEMBER_ID);
  });

  it("resolves the acting org_member and scopes the entry to their org", async () => {
    const { record } = await import("./audit.service.js");
    await record(auth, {
      action: "claim.created",
      entityType: "claim",
      entityId: "claim-1",
      after: { status: "DRAFT" },
    });

    expect(auditRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        actorId: MEMBER_ID,
        action: "claim.created",
        entityType: "claim",
        entityId: "claim-1",
        after: { status: "DRAFT" },
      }),
    );
  });

  it("uses a caller-supplied actorId instead of looking it up again", async () => {
    const { record } = await import("./audit.service.js");
    await record(auth, {
      action: "claim.status_changed",
      entityType: "claim",
      entityId: "claim-1",
      actorId: "already-known",
    });

    expect(orgMembersRepository.getOrgMemberId).not.toHaveBeenCalled();
    expect(auditRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "already-known" }),
    );
  });

  it("never throws when the write fails — the audited change already committed", async () => {
    vi.mocked(auditRepository.insert).mockRejectedValue(new Error("db down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { record } = await import("./audit.service.js");

    // The assertion is that this resolves rather than rejecting: raising
    // here would report failure for a mutation that actually succeeded.
    await expect(
      record(auth, {
        action: "document.confirmed",
        entityType: "document",
        entityId: "doc-1",
      }),
    ).resolves.toBeUndefined();

    // ...but it must be loud, not silent.
    expect(consoleError).toHaveBeenCalledWith(
      "audit write failed",
      expect.objectContaining({ action: "document.confirmed" }),
    );
    consoleError.mockRestore();
  });

  it("omits before/after entirely when the caller passes neither", async () => {
    const { record } = await import("./audit.service.js");
    await record(auth, {
      action: "query.replied",
      entityType: "query",
      entityId: "q-1",
    });

    const entry = vi.mocked(auditRepository.insert).mock.calls[0]![0];
    expect(entry).not.toHaveProperty("before");
    expect(entry).not.toHaveProperty("after");
  });
});
