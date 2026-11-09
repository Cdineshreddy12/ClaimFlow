import { useSyncExternalStore } from "react";

/**
 * The current time, ticking.
 *
 * Every clock in the product was frozen: `useMemo(() => Date.now(), [])`
 * on three pages and a render-time default on the SLA chip, so a
 * countdown only moved when something else happened to re-render it. A
 * desk watching the last ten minutes of an IRDAI hour saw a number
 * that never changed, which is worse than no clock — it looks live and
 * isn't.
 *
 * One interval for the whole app rather than one per clock. Besides the
 * obvious cost of N timers, separate intervals drift: two chips on the
 * same screen would tick a few hundred milliseconds apart and show
 * different seconds for the same deadline. `useSyncExternalStore` is
 * exactly the tool for this — subscribers share one value and React
 * batches the re-render.
 *
 * Never the authority on whether something is late. Deadlines are
 * stamped by the server (docs/adr/0004) and this only decides how they
 * are drawn; a wrong clock on a laptop makes a countdown wrong, not a
 * claim overdue.
 */
const TICK_MS = 1000;

const listeners = new Set<() => void>();
let current = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

function emit() {
  current = Date.now();
  for (const listener of listeners) listener();
}

function start() {
  if (timer === undefined) timer = setInterval(emit, TICK_MS);
}

function stop() {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

/*
  A backgrounded tab has nobody reading its countdowns, and browsers
  throttle the interval there anyway — so stop, and catch up in one
  step on the way back rather than showing a stale second until the
  next tick.
*/
function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    emit();
    if (listeners.size > 0) start();
  } else {
    stop();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") start();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

/** Stable between ticks, so React only re-renders when the second changes. */
function getSnapshot(): number {
  return current;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
