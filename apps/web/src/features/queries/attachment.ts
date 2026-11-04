/**
 * There's no per-requested-item attachment tracking in the schema — queries
 * only store free-text requestedItems strings, with no link to a specific
 * document or checklist slot. This is a best-effort signal computed from
 * real data (the claim's already-confirmed checklist slots), not a stored
 * fact, so a false negative is possible when the TPA's wording doesn't
 * resemble the checklist slot name at all.
 */
export function isRequestedItemAttached(
  requestedItem: string,
  satisfiedSlots: string[],
): boolean {
  const needle = requestedItem.toLowerCase();
  return satisfiedSlots.some((slot) => {
    const haystack = slot.toLowerCase();
    return needle.includes(haystack) || haystack.includes(needle);
  });
}
