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
          sunken: "var(--surface-sunken)",
        },
        hover: "var(--hover)",
        active: "var(--active)",
        // The nav rail keeps its own ramp: it stays dark regardless of
        // the app's light/dark theme, the way the reference product's
        // nav does.
        sidebar: {
          DEFAULT: "var(--sidebar-bg)",
          border: "var(--sidebar-border)",
          ink: "var(--sidebar-ink)",
          soft: "var(--sidebar-ink-soft)",
          faint: "var(--sidebar-ink-faint)",
          hover: "var(--sidebar-hover-bg)",
          active: "var(--sidebar-active-bg)",
          ring: "var(--sidebar-active-ring)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          hover: "var(--primary-hover)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          soft: "var(--ink-soft)",
          faint: "var(--ink-faint)",
        },
        line: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
          divider: "var(--divider)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
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
      boxShadow: {
        card: "var(--card-shadow)",
        raised: "var(--card-shadow-raised)",
      },
      // The b2b-crm's radius scale, matching the --r-* variables.
      borderRadius: {
        xs: "4px",
        sm: "6px",
        DEFAULT: "6px",
        md: "8px",
        lg: "10px",
        xl: "14px",
      },
      fontFamily: {
        sans: [
          '"Inter"',
          '"Helvetica Neue"',
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      /**
       * The same eight steps the CSS variables define, so `text-sm` in a
       * component and `var(--text-sm)` in the stylesheet are one size
       * rather than two.
       *
       * Overlapping keys override Tailwind's rem-based defaults, so a
       * `text-sm` can't quietly mean 14px in a component while the
       * stylesheet next to it means 12.5px.
       */
      fontSize: {
        "2xs": ["11px", "16px"],
        xs: ["11.5px", "16px"],
        sm: ["12.5px", "18px"],
        base: ["13.5px", "20px"],
        md: ["14px", "20px"],
        lg: ["16px", "24px"],
        xl: ["18px", "28px"],
        "2xl": ["22px", "30px"],
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
