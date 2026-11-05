import type { ClaimStatus } from "@claimflow/contracts";
import { describe, expect, it } from "vitest";
import {
  applyClaimList,
  DEFAULT_LIST_STATE,
  filterClaims,
  nextSort,
  sortClaims,
} from "./list";
import type { Claim } from "./types";

function claim(overrides: Partial<Claim> & { id: string }): Claim {
  return {
    reference: `CLM-${overrides.id.slice(-4)}`,
    patientName: "Rajendra Pawar",
    insurerId: "i1",
    insurerName: "Company B",
    procedureId: "p1",
    procedureName: "Gall bladder removal",
    status: "PRE_AUTH_SENT" as ClaimStatus,
    assignedTo: null,
    checklistSnapshot: [],
    billedAmount: "100000.00",
    sanctionedAmount: null,
    settledAmount: null,
    settledOn: null,
    slaDeadline: null,
    admittedAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("filterClaims", () => {
  const claims = [
    claim({ id: "aaaaaaaa-1", patientName: "Sunita Deshmukh" }),
    claim({ id: "bbbbbbbb-2", status: "SETTLED" }),
    claim({ id: "cccccccc-3", status: "QUERY_RAISED" }),
    claim({ id: "dddddddd-4", status: "REJECTED" }),
  ];

  it("defaults to open claims, hiding settled and rejected", () => {
    const open = filterClaims(claims, { search: "", status: "open" });
    expect(open.map((c) => c.id)).toEqual(["aaaaaaaa-1", "cccccccc-3"]);
  });

  it("separates 'needs attention' from merely open", () => {
    // A sent pre-auth is open but waiting on the insurer; only a query
    // or enhancement is waiting on the desk.
    const attention = filterClaims(claims, {
      search: "",
      status: "attention",
    });
    expect(attention.map((c) => c.id)).toEqual(["cccccccc-3"]);
  });

  it("shows everything on 'all'", () => {
    expect(filterClaims(claims, { search: "", status: "all" })).toHaveLength(4);
  });

  it("searches patient, insurer, procedure and the short claim id", () => {
    const by = (search: string) =>
      filterClaims(claims, { search, status: "all" }).map((c) => c.id);

    expect(by("sunita")).toEqual(["aaaaaaaa-1"]);
    expect(by("company b")).toHaveLength(4);
    expect(by("gall")).toHaveLength(4);
    // The reference a desk reads off a TPA email, not the uuid.
    expect(by("clm-cc-3")).toEqual(["cccccccc-3"]);
    // The uuid itself is not searchable — it isn't shown anywhere.
    expect(by("cccccccc")).toEqual([]);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(
      filterClaims(claims, { search: "  SUNITA  ", status: "all" }),
    ).toHaveLength(1);
  });

  it("treats a blank search as no filter at all", () => {
    expect(filterClaims(claims, { search: "   ", status: "all" })).toHaveLength(
      4,
    );
  });
});

describe("sortClaims", () => {
  it("puts the longest-waiting claim first by default", () => {
    const claims = [
      claim({ id: "recent", updatedAt: "2026-11-04T00:00:00.000Z" }),
      claim({ id: "stale", updatedAt: "2026-10-28T00:00:00.000Z" }),
    ];
    const sorted = applyClaimList(claims, DEFAULT_LIST_STATE);
    expect(sorted[0]?.id).toBe("stale");
  });

  it("sorts status by lifecycle position, not alphabetically", () => {
    // Alphabetically "Approved" would beat "Draft"; by lifecycle it doesn't.
    const claims = [
      claim({ id: "approved", status: "APPROVED" }),
      claim({ id: "draft", status: "DRAFT" }),
    ];
    const sorted = sortClaims(claims, "status", "asc");
    expect(sorted.map((c) => c.id)).toEqual(["draft", "approved"]);
  });

  it("sorts an unset amount last in both directions", () => {
    // Counting null as zero would bury a brand-new claim under settled
    // rupees, which is exactly where nobody looks for it.
    const claims = [
      claim({ id: "none", billedAmount: null }),
      claim({ id: "small", billedAmount: "50000.00" }),
      claim({ id: "large", billedAmount: "500000.00" }),
    ];
    expect(sortClaims(claims, "amount", "asc").map((c) => c.id)).toEqual([
      "small",
      "large",
      "none",
    ]);
    expect(sortClaims(claims, "amount", "desc").map((c) => c.id)).toEqual([
      "none",
      "large",
      "small",
    ]);
  });

  it("doesn't mutate the array it was given", () => {
    const claims = [claim({ id: "b" }), claim({ id: "a" })];
    const before = claims.map((c) => c.id);
    sortClaims(claims, "patient", "asc");
    expect(claims.map((c) => c.id)).toEqual(before);
  });
});

describe("nextSort", () => {
  it("flips direction when the same column is clicked again", () => {
    const first = nextSort(DEFAULT_LIST_STATE, "stageTime");
    expect(first.direction).toBe("asc");
    expect(nextSort(first, "stageTime").direction).toBe("desc");
  });

  it("starts a name column ascending and a time column descending", () => {
    expect(nextSort(DEFAULT_LIST_STATE, "patient")).toMatchObject({
      sortKey: "patient",
      direction: "asc",
    });
    expect(nextSort(DEFAULT_LIST_STATE, "amount")).toMatchObject({
      sortKey: "amount",
      direction: "desc",
    });
  });

  it("keeps the search and status filter when the sort changes", () => {
    const state = {
      ...DEFAULT_LIST_STATE,
      search: "pawar",
      status: "all" as const,
    };
    expect(nextSort(state, "insurer")).toMatchObject({
      search: "pawar",
      status: "all",
    });
  });
});
