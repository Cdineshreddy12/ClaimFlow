import { X } from "reicon-react";
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
    <div className="flex items-center gap-2.5 border-b border-line px-1 py-2.5 last:border-b-0">
      <div className="flex-1 text-base font-medium">{rule.documentType}</div>

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
          <X size={13} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
