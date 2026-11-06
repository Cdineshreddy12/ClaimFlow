import { describe, expect, it } from "vitest";
import { DEFAULT_LIST_STATE, nextSort } from "./list";

/**
 * What clicking a column header does.
 *
 * The filtering, searching and ordering themselves moved into SQL —
 * their definitions, and their tests, now live beside the query in
 * @claimflow/contracts. What is left on this screen is its own state.
 */
describe("nextSort", () => {
  it("flips the column that is already sorted", () => {
    const state = {
      ...DEFAULT_LIST_STATE,
      sortKey: "patient" as const,
      direction: "asc" as const,
    };
    expect(nextSort(state, "patient").direction).toBe("desc");
    expect(nextSort(nextSort(state, "patient"), "patient").direction).toBe(
      "asc",
    );
  });

  it("starts a new column on the order someone means by picking it", () => {
    // Names read A–Z; money and waiting time read biggest-first,
    // because nobody opens a claims list to find the smallest bill.
    expect(nextSort(DEFAULT_LIST_STATE, "patient").direction).toBe("asc");
    expect(nextSort(DEFAULT_LIST_STATE, "insurer").direction).toBe("asc");
    expect(nextSort(DEFAULT_LIST_STATE, "amount").direction).toBe("desc");
    // From a column that isn't already the active one — stageTime is
    // the default, so picking it from here would flip it instead.
    const onPatient = { ...DEFAULT_LIST_STATE, sortKey: "patient" as const };
    expect(nextSort(onPatient, "stageTime").direction).toBe("desc");
  });

  it("keeps the search and filter alone", () => {
    const state = {
      ...DEFAULT_LIST_STATE,
      search: "pawar",
      status: "all" as const,
    };
    const next = nextSort(state, "insurer");
    expect(next.search).toBe("pawar");
    expect(next.status).toBe("all");
  });

  it("opens on the longest-waiting claim", () => {
    // The top of the list should be the thing most at risk, not the
    // thing most recently touched.
    expect(DEFAULT_LIST_STATE.sortKey).toBe("stageTime");
    expect(DEFAULT_LIST_STATE.direction).toBe("desc");
    expect(DEFAULT_LIST_STATE.status).toBe("open");
  });
});
