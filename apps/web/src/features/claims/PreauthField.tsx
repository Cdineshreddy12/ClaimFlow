import { useEffect, useRef, useState } from "react";
import {
  LOW_CONFIDENCE_THRESHOLD,
  PREAUTH_EXTRACTOR_LABEL,
  type PreauthFieldDef,
} from "@claimflow/contracts";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  editableValue,
  formatPreauthValue,
  inputTypeFor,
} from "../preauth/display";
import type { PreauthFieldRow } from "../preauth/types";

/**
 * One field on the pre-auth form.
 *
 * Three states, and the difference between the first two is the whole
 * point of docs/adr/0005: a suggestion renders dashed and unconfirmed
 * with the words it was read from, and does not become the value until
 * someone clicks Confirm. Nothing here ever promotes `aiValue` on its
 * own — the confirm button sends it back to the server as a human
 * decision, which is what makes it count.
 */
export function PreauthField({
  field,
  row,
  onConfirm,
  onClear,
  isBusy,
}: {
  field: PreauthFieldDef;
  row: PreauthFieldRow | undefined;
  onConfirm: (value: string) => void;
  onClear: () => void;
  isBusy: boolean;
}) {
  const confirmed = Boolean(row?.confirmedAt && row.value);
  const suggestion = row?.aiValue ?? null;
  const needsConfirm = !confirmed && suggestion !== null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEditing() {
    setDraft(editableValue(row?.value ?? suggestion));
    setEditing(true);
  }

  function save() {
    const value = draft.trim();
    if (!value) return;
    onConfirm(value);
    setEditing(false);
  }

  const confidence = row?.confidence === null ? null : Number(row?.confidence);
  const isLowConfidence =
    confidence !== null &&
    confidence !== undefined &&
    confidence < LOW_CONFIDENCE_THRESHOLD;

  return (
    <div className={`field${needsConfirm ? " field--needs-confirm" : ""}`}>
      <div className="field-label">{field.label}</div>

      {editing ? (
        <div className="field-edit">
          {field.type === "enum" ? (
            <Select value={draft || undefined} onValueChange={setDraft}>
              <SelectTrigger aria-label={field.label}>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : field.type === "longtext" ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              rows={3}
              aria-label={field.label}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="field-input"
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type={inputTypeFor(field)}
              aria-label={field.label}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              className="field-input"
            />
          )}
        </div>
      ) : (
        <div
          className={`field-value${field.type === "currency" || field.type === "date" ? " mono" : ""}`}
        >
          {formatPreauthValue(field, row?.value ?? suggestion)}
        </div>
      )}

      {/* The evidence, verbatim. A suggestion a human can't check is one
          they either rubber-stamp or ignore. Kept visible after
          confirming too, so the trail doesn't vanish on the click. */}
      {row?.sourceSnippet && !editing ? (
        <div className="field-source">&ldquo;{row.sourceSnippet}&rdquo;</div>
      ) : null}

      {needsConfirm && row?.extractedBy && !editing ? (
        <div className={isLowConfidence ? "field-hint-low" : "field-conf"}>
          {PREAUTH_EXTRACTOR_LABEL[row.extractedBy]}
          {confidence !== null && confidence !== undefined
            ? ` · ${Math.round(confidence * 100)}%`
            : ""}
          {isLowConfidence ? " · worth checking" : ""}
        </div>
      ) : null}

      <div className="field-foot">
        {editing ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={!draft.trim() || isBusy}
              onClick={save}
            >
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </>
        ) : confirmed ? (
          <>
            <span className="field-ok">
              <CheckIcon />
              Confirmed
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isBusy}
              onClick={startEditing}
            >
              Change
            </Button>
          </>
        ) : needsConfirm ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={isBusy}
              onClick={() => onConfirm(suggestion)}
            >
              Confirm
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isBusy}
              onClick={startEditing}
            >
              Edit
            </Button>
            {/* Wrong rather than imprecise — clearing drops the
                suggestion out of the way without inventing a value. */}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isBusy}
              onClick={onClear}
            >
              Discard
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isBusy}
            onClick={startEditing}
          >
            Add
          </Button>
        )}
      </div>
    </div>
  );
}
