import { useId, type ReactNode } from "react";
import { CountBadge } from "./badge";

export interface TabDef {
  id: string;
  label: string;
  /** Shown beside the label — "3 missing", "0 of 24". A count a desk acts on, not decoration. */
  badge?: string;
  /** Pulls the badge red when it's something overdue rather than merely outstanding. */
  badgeTone?: "critical" | "pending" | "neutral";
}

/**
 * A minimal tablist.
 *
 * Deliberately not Radix: this needs arrow-key roving and nothing else,
 * and pulling in another primitive for one screen costs more than the
 * twenty lines below.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  children,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  children: ReactNode;
}) {
  const base = useId();

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === active);
    if (e.key === "ArrowRight") {
      onChange(tabs[(i + 1) % tabs.length]!.id);
    } else if (e.key === "ArrowLeft") {
      onChange(tabs[(i - 1 + tabs.length) % tabs.length]!.id);
    } else {
      return;
    }
    e.preventDefault();
  }

  return (
    <div>
      <div
        className="mb-[18px] flex gap-0.5 overflow-x-auto border-b border-line"
        role="tablist"
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${base}-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`${base}-${tab.id}-panel`}
              tabIndex={isActive ? 0 : -1}
              className={`-mb-px inline-flex cursor-pointer items-center gap-2 whitespace-nowrap border-0 border-b-2 bg-transparent px-3.5 py-[9px] font-[inherit] text-md ${
                isActive
                  ? "border-b-accent font-semibold text-ink"
                  : "border-b-transparent font-medium text-ink-soft hover:text-ink"
              }`}
              onClick={() => onChange(tab.id)}
            >
              {tab.label}
              {tab.badge ? (
                <CountBadge tone={tab.badgeTone ?? "neutral"}>
                  {tab.badge}
                </CountBadge>
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-${active}-panel`}
        aria-labelledby={`${base}-${active}`}
      >
        {children}
      </div>
    </div>
  );
}
