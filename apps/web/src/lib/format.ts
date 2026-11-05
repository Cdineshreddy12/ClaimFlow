/** "2d 6h", "6h 02m", "40m" — mirrors the mockup's stage-time formatting. */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${minutes}m`;
}

export function formatAmount(value: string | number | null): string {
  if (value === null) return "—";
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

/** "₹1.5L", "₹2Cr" — Indian lakh/crore notation for chart labels, where
 * a full comma-grouped amount would overrun the mark it's labeling. */
export function formatCompactAmount(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}K`;
  return `${sign}₹${abs}`;
}
