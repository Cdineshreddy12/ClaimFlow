import { beforeEach, describe, expect, it, vi } from "vitest";
import * as checklistRepository from "./checklist.repository.js";
import { getCoverage } from "./checklist.service.js";

vi.mock("./checklist.repository.js");

const auth = { userId: "u1" };

function pair(overrides: Partial<checklistRepository.CoverageRow> = {}) {
  return {
    insurerId: "i1",
    insurerName: "Company B",
    procedureId: "p1",
    procedureName: "Gall bladder removal",
    rules: 6,
    claims: 3,
    activeClaims: 1,
    lastClaimAt: new Date("2026-11-01T00:00:00Z"),
    ...overrides,
  } as checklistRepository.CoverageRow;
}

describe("checklist coverage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("separates the pairs with no checklist from the ones that have one", async () => {
    vi.mocked(checklistRepository.listCoverage).mockResolvedValue([
      pair(),
      pair({ procedureName: "Dengue with low platelets", rules: 0, claims: 2 }),
    ]);

    const result = await getCoverage(auth);

    expect(result.uncovered).toHaveLength(1);
    expect(result.uncovered[0]!.procedureName).toBe(
      "Dengue with low platelets",
    );
    expect(result.covered).toHaveLength(1);
  });

  it("puts the most-used uncovered pair first", async () => {
    vi.mocked(checklistRepository.listCoverage).mockResolvedValue([
      pair({ procedureName: "Rare one", rules: 0, claims: 1 }),
      pair({ procedureName: "Common one", rules: 0, claims: 40 }),
    ]);

    const result = await getCoverage(auth);

    // The list is read to decide what to fix first, and alphabetical
    // decides nothing.
    expect(result.uncovered[0]!.procedureName).toBe("Common one");
    expect(result.uncoveredClaims).toBe(41);
  });

  it("reports a fully covered desk as zero rather than as nothing", async () => {
    vi.mocked(checklistRepository.listCoverage).mockResolvedValue([pair()]);

    const result = await getCoverage(auth);

    expect(result.uncovered).toEqual([]);
    expect(result.uncoveredClaims).toBe(0);
  });
});
