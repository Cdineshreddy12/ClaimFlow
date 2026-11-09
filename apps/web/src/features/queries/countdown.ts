import { formatTimeLeft } from "../../lib/format";

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
      text: `−${formatTimeLeft(diff)}`,
      label: "Reply window closed",
      isOverdue: true,
    };
  }
  return {
    text: `+${formatTimeLeft(diff)}`,
    label: "Reply window closes in",
    isOverdue: false,
  };
}
