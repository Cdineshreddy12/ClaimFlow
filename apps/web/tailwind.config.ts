import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Tailwind is pointed at the same CSS variables the hand-written design
 * system in src/styles/index.css already defines (ported from the
 * approved mockup). shadcn components therefore inherit the approved
 * palette and dark mode for free, rather than introducing a second,
 * competing set of colours.
 */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        surface: {
          DEFAULT: "var(--surface)",
          raised: "var(--surface-raised)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          soft: "var(--ink-soft)",
          faint: "var(--ink-faint)",
        },
        line: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          ink: "var(--accent-ink)",
          soft: "var(--accent-soft)",
        },
        approved: {
          DEFAULT: "var(--approved)",
          bg: "var(--approved-bg)",
        },
        pending: {
          DEFAULT: "var(--pending)",
          bg: "var(--pending-bg)",
        },
        critical: {
          DEFAULT: "var(--critical)",
          bg: "var(--critical-bg)",
        },
        neutral: {
          DEFAULT: "var(--neutral)",
          bg: "var(--neutral-bg)",
        },
      },
      borderRadius: {
        sm: "5px",
        DEFAULT: "6px",
        md: "7px",
        lg: "8px",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "-apple-system", '"Segoe UI"', "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      keyframes: {
        "select-in": {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "select-in": "select-in 0.12s ease",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
