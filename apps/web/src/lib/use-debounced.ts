import { useEffect, useState } from "react";

/**
 * The value, once it has stopped changing.
 *
 * Typing is not a request. The claims search fired a query per
 * keystroke, which was free while the filtering happened in the
 * browser and is a round trip per letter now that it does not — and
 * on a slow link the replies can arrive out of order, so the table
 * ends up showing the results for "raj" after the ones for "rajen".
 */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return settled;
}
