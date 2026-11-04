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
