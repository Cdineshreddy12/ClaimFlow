import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's standard class helper — merges conditional classes and resolves Tailwind conflicts so a caller's override actually wins. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
