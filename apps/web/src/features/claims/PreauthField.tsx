import { useEffect, useRef, useState } from "react";
import {
  LOW_CONFIDENCE_THRESHOLD,
  PREAUTH_EXTRACTOR_LABEL,
  parseFileValue,
} from "@claimflow/contracts";
import { X } from "reicon-react";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { uploadFieldFile } from "../preauth/api";
import type { PreauthFieldRow } from "../preauth/types";

/**
 * One field on the pre-auth form, as a row.
 *
 * It was a card in a grid, which fought the content: fields range from
 * "8" to a four-line clinical finding, and a grid either stretches every
 * cell in a row to the tallest or — once wide fields span two tracks —
 * leaves ragged holes, because CSS grid cannot reflow around varying
 * heights. Rows have none of that geometry. They also align every label
 * in one column, which is what makes twenty-four of them scannable.
 *
 * The confirmation rule is unchanged (docs/adr/0005): a suggestion shows
 * with the words it was read from and does not become the value until a
 * human clicks Confirm. Nothing here promotes `aiValue` on its own.
 */
/**
 * What a row needs to render itself — a flattened placement, not the
 * static catalogue entry. The form is configurable now, so the label
 * may be an override and the field may not be one of the standard 24.
 */
export interface RenderField {
  key: string;
  label: string;
  type: string;
  hint: string | null;
  options: { value: string; label: string }[] | null;
  required: boolean;
}

export function PreauthField({
  claimId,
  field,
  row,
  onConfirm,
  onClear,
  isBusy,
  layout = "row",
}: {
  claimId: string;
  field: RenderField;
  row: PreauthFieldRow | undefined;
  onConfirm: (value: string) => void;
  onClear: () => void;
  isBusy: boolean;
  /**
   * `"row"` puts label, value and buttons on one line; `"stacked"` puts
   * the value under its label.
   *
   * The caller decides because only the caller knows how wide the row
   * will be. A label column and two buttons take around 400px between
   * them, so in a section the layout splits into two columns there is
   * essentially nothing left for the value — "Dr. S. A. Kulkarni" came
   * out one letter per line. A `md:` breakpoint can't see that: it
   * measures the window, not the column the row was put in.
   */
  layout?: "row" | "stacked";
}) {
  const confirmed = Boolean(row?.confirmedAt && row.value);
  const suggestion = row?.aiValue ?? null;
  const needsConfirm = !confirmed && suggestion !== null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
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

  // When the quote is just the value again, showing both is noise. The
  // evidence rule is satisfied either way — the point is that the desk
  // can see where a value came from, and when the quote *is* the value
  // they are already reading it.
  const snippet = row?.sourceSnippet?.trim() ?? "";
  const shown = (row?.value ?? row?.aiValue ?? "").trim();
  const normalise = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const snippetAddsNothing =
    snippet.length > 0 &&
    shown.length > 0 &&
    normalise(snippet) === normalise(shown);

  const confidence = row?.confidence == null ? null : Number(row.confidence);
  const isLowConfidence =
    confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD;

  const state = confirmed
    ? "confirmed"
    : needsConfirm
      ? "unconfirmed"
      : "empty";

  const frame = `border-b border-l-[3px] border-b-line px-3.5 py-3 last:border-b-0 ${
    state === "unconfirmed"
      ? "border-l-pending bg-pending-bg"
      : state === "confirmed"
        ? "border-l-approved hover:bg-accent-soft"
        : "border-l-transparent hover:bg-accent-soft"
  }`;

  const label = (
    <div className="min-w-0 pt-0.5 text-sm font-semibold leading-[1.35] text-ink-soft">
      {field.label}
      {field.required ? (
        <span className="text-critical" aria-label="required">
          {" *"}
        </span>
      ) : null}
      {field.hint ? (
        <span className="mt-0.5 block text-xs font-normal text-ink-faint">
          {field.hint}
        </span>
      ) : null}
    </div>
  );

  const value = (
    <div className="flex min-w-0 flex-col gap-[5px]">
      {field.type === "file" ? (
        <FileControl
          claimId={claimId}
          value={row?.value ?? row?.aiValue ?? null}
          isBusy={isBusy || uploading}
          uploading={uploading}
          error={uploadError}
          onUpload={async (file: File) => {
            setUploadError(null);
            setUploading(true);
            try {
              onConfirm(await uploadFieldFile(claimId, file));
            } catch (err) {
              setUploadError(
                err instanceof Error ? err.message : "Upload failed.",
              );
            } finally {
              setUploading(false);
            }
          }}
        />
      ) : editing ? (
        <div className="flex flex-col gap-1.5">
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
            <Textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              rows={3}
              aria-label={field.label}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <Input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type={inputTypeFor(field)}
              aria-label={field.label}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
            />
          )}
        </div>
      ) : (
        <div
          className={`text-md font-semibold leading-[1.45] [overflow-wrap:anywhere]${
            field.type === "currency" || field.type === "date"
              ? " font-mono tabular-nums"
              : ""
          }${state === "empty" ? " !font-normal text-ink-faint" : ""}`}
        >
          {formatPreauthValue(field, row?.value ?? suggestion)}
        </div>
      )}

      {snippet && !editing && !snippetAddsNothing ? (
        <blockquote className="m-0 border-l-2 border-line-strong pl-[9px] text-sm leading-[1.45] text-ink-faint">
          {snippet}
        </blockquote>
      ) : null}

      {needsConfirm && row?.extractedBy && !editing ? (
        <div
          className={`text-xs${isLowConfidence ? " font-semibold text-pending" : " text-ink-faint"}`}
        >
          {PREAUTH_EXTRACTOR_LABEL[row.extractedBy]}
          {confidence !== null ? ` · ${Math.round(confidence * 100)}%` : ""}
          {isLowConfidence ? " · worth checking" : ""}
        </div>
      ) : null}
    </div>
  );

  const actions = (
    <div className="flex shrink-0 flex-wrap items-center justify-start gap-1.5">
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
            variant="outline"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </>
      ) : confirmed ? (
        <>
          <span className="flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-approved">
            <CheckIcon />
            Confirmed
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
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
            variant="outline"
            disabled={isBusy}
            onClick={startEditing}
          >
            Edit
          </Button>
          {/* Wrong rather than imprecise — clearing drops the
                suggestion without inventing a value. */}
          <button
            type="button"
            className="cursor-pointer rounded-xs border-0 bg-transparent px-[5px] py-[3px] text-sm leading-none text-ink-faint hover:bg-critical-bg hover:text-critical disabled:cursor-default disabled:opacity-40"
            disabled={isBusy}
            onClick={onClear}
            aria-label={`Discard the suggestion for ${field.label}`}
            title="Discard this suggestion"
          >
            <X size={12} aria-hidden />
          </button>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          onClick={startEditing}
        >
          Add
        </Button>
      )}
    </div>
  );

  // Stacked keeps the label and the buttons on the top line, where they
  // stay scannable down the column, and gives the value the column's
  // whole width underneath.
  if (layout === "stacked") {
    return (
      <div className={`${frame} flex flex-col gap-[7px]`}>
        <div className="flex items-start justify-between gap-3">
          {label}
          {actions}
        </div>
        {value}
      </div>
    );
  }

  return (
    <div
      className={`${frame} grid grid-cols-1 items-start gap-[7px] md:grid-cols-[210px_minmax(0,1fr)_auto] md:gap-4`}
    >
      {label}
      {value}
      {actions}
    </div>
  );
}

/**
 * A file answering a form field.
 *
 * Replaces the value outright rather than appending — a field holds one
 * answer, and "which of these three is the current one" is a question
 * a desk shouldn't have to answer on a pre-auth.
 *
 * Confirming happens on upload: a file that is sitting in S3 under this
 * claim's prefix *is* the human's act. There's no model guess to check
 * against, which is what the confirm step exists for everywhere else.
 */
function FileControl({
  claimId,
  value,
  isBusy,
  uploading,
  error,
  onUpload,
}: {
  claimId: string;
  value: string | null;
  isBusy: boolean;
  uploading: boolean;
  error: string | null;
  onUpload: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const current = parseFileValue(value);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {current ? (
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-base font-semibold [overflow-wrap:anywhere]">
            {current.fileName}
          </span>
          <span className="whitespace-nowrap text-xs text-ink-faint">
            {formatBytes(current.sizeBytes)}
          </span>
        </div>
      ) : (
        <span className="text-md font-normal leading-[1.45] text-ink-faint [overflow-wrap:anywhere]">
          No file yet
        </span>
      )}

      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset first: picking the same file twice in a row fires no
          // change event otherwise, so a retry after a failure does
          // nothing at all.
          e.target.value = "";
          if (file) onUpload(file);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isBusy}
        onClick={() => input.current?.click()}
      >
        {uploading ? "Uploading…" : current ? "Replace" : "Upload"}
      </Button>

      {error ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** "1.2 MB" — a desk judges a scan by size, not by byte count. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
