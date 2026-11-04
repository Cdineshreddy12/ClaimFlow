import { formatDuration } from "../../lib/format";

export interface Countdown {
  text: string;
  label: string;
  isOverdue: boolean;
}

export function formatCountdown(
  deadline: string | null,
  now: number,
): Countdown | null {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - now;
  if (diff < 0) {
    return {
      text: `−${formatDuration(diff)}`,
      label: "Reply window closed",
      isOverdue: true,
    };
  }
  return {
    text: `+${formatDuration(diff)}`,
    label: "Reply window closes in",
    isOverdue: false,
  };
}
