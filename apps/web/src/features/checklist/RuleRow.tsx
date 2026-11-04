import { cn } from "@/lib/utils";
import type { ChecklistRule } from "./api";

export function RuleRow({
  rule,
  canEdit,
  isBusy,
  onToggleRequired,
  onRemove,
}: {
  rule: ChecklistRule;
  canEdit: boolean;
  isBusy: boolean;
  onToggleRequired: (required: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div className="doc-item">
      <div className="doc-name">{rule.documentType}</div>

      {/* Two buttons rather than a checkbox: "Required" and "Optional" are
          both meaningful states a desk head picks between, and the label
          should say which one is active without decoding a tick. */}
      <div
        className="inline-flex overflow-hidden rounded-sm border border-line-strong text-[12px] font-semibold"
        role="group"
        aria-label={`${rule.documentType} requirement`}
      >
        {([true, false] as const).map((required) => {
          const active = rule.required === required;
          return (
            <button
              key={String(required)}
              type="button"
              disabled={!canEdit || isBusy || active}
              aria-pressed={active}
              onClick={() => onToggleRequired(required)}
              className={cn(
                "px-2.5 py-1 transition-colors",
                active
                  ? "bg-accent text-surface-raised"
                  : "bg-surface-raised text-ink-soft hover:bg-accent-soft",
                !canEdit && "cursor-not-allowed opacity-60",
              )}
            >
              {required ? "Required" : "Optional"}
            </button>
          );
        })}
      </div>

      {canEdit ? (
        <button
          type="button"
          disabled={isBusy}
          onClick={onRemove}
          aria-label={`Remove ${rule.documentType}`}
          className="rounded-sm p-1 text-ink-faint transition-colors hover:bg-critical-bg hover:text-critical disabled:opacity-50"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="M4.5 4.5l7 7M11.5 4.5l-7 7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
