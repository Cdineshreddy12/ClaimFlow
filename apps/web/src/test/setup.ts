import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Shared setup for the component tests.
 *
 * `cleanup` after every test because Testing Library renders into a
 * container it does not remove itself — without this, the second test
 * in a file queries a document still holding the first one's markup and
 * fails on an ambiguous match, for reasons that have nothing to do with
 * the component.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * jsdom implements neither of these, and both are reached by code under
 * test: the panel scrolls itself as messages arrive, and a chip opens
 * the file it is about. Stubbed here rather than worked around in the
 * components — a component that avoids the DOM to suit its tests is the
 * wrong trade.
 */
Element.prototype.scrollTo = vi.fn();
window.open = vi.fn();
