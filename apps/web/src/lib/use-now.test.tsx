import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

function Clock({ label }: { label: string }) {
  const now = useNow();
  return <span data-testid={label}>{now}</span>;
}

/** Drives the property the hook reads, plus the event it listens for. */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves on without anything else re-rendering the page", () => {
    render(<Clock label="a" />);
    const first = screen.getByTestId("a").textContent;

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByTestId("a").textContent).not.toBe(first);
  });

  it("keeps every clock on the same second", () => {
    // Separate intervals drift, and two chips on one screen showing
    // different seconds for the same deadline reads as a bug.
    render(
      <>
        <Clock label="a" />
        <Clock label="b" />
      </>,
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByTestId("a").textContent).toBe(
      screen.getByTestId("b").textContent,
    );
  });

  it("stops while the tab is hidden and catches up in one step", () => {
    render(<Clock label="a" />);

    act(() => setVisibility("hidden"));
    const parked = screen.getByTestId("a").textContent;

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByTestId("a").textContent).toBe(parked);

    // Back in front of someone: the value is right immediately rather
    // than showing a stale second until the next tick.
    act(() => setVisibility("visible"));
    expect(screen.getByTestId("a").textContent).not.toBe(parked);
  });

  it("leaves no interval running once the last clock unmounts", () => {
    const { unmount } = render(<Clock label="a" />);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
