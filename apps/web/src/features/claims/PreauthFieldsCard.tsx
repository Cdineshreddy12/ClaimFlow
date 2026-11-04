import { useState } from "react";
import {
  PREAUTH_FIELDS,
  PREAUTH_GROUP_LABEL,
  PreauthFieldGroup,
  isFieldApplicable,
} from "@claimflow/contracts";
import { Button } from "@/components/ui/button";
import {
  useClearPreauthField,
  useConfirmPreauthField,
  useExtractPreauthFields,
  usePreauthFields,
} from "../preauth/api";
import { PreauthField } from "./PreauthField";
import type { Claim } from "./types";

/**
 * The hospital's half of the IRDAI pre-auth form, filled from the
 * claim's confirmed documents.
 *
 * This is the retyping the brief is about: a diagnosis, an ICD code, an
 * admission date and eight cost lines copied out of a doctor's note by
 * hand, per admission. Reading them is one click; none of them land
 * until a human confirms (docs/adr/0005).
 *
 * Collapsed by default once there's nothing waiting on a decision. The
 * claim file has to show what's missing and overdue without scrolling,
 * and two dozen settled fields sitting open would push the gap view off
 * the screen — but anything needing confirmation opens the section
 * itself, so it can't hide.
 */
export function PreauthFieldsCard({ claim }: { claim: Claim }) {
  const { data, isLoading } = usePreauthFields(claim.id);
  const extract = useExtractPreauthFields(claim.id);
  const confirm = useConfirmPreauthField(claim.id);
  const clear = useClearPreauthField(claim.id);

  const rows = data?.fields ?? [];
  const byKey = new Map(rows.map((r) => [r.fieldKey, r]));
  const values = Object.fromEntries(rows.map((r) => [r.fieldKey, r.value]));

  const applicable = PREAUTH_FIELDS.filter((f) => isFieldApplicable(f, values));
  const confirmedCount = applicable.filter(
    (f) => byKey.get(f.key)?.confirmedAt,
  ).length;
  const awaiting = applicable.filter((f) => {
    const row = byKey.get(f.key);
    return row?.aiValue && !row.confirmedAt;
  }).length;

  // Opens itself when something needs a decision; otherwise stays shut.
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  const open = manuallyOpen ?? awaiting > 0;

  const isBusy = confirm.isPending || clear.isPending || extract.isPending;

  return (
    <div className="card card-pad preauth-card">
      <div className="card-head">
        <div className="preauth-head-left">
          <button
            type="button"
            className="preauth-toggle"
            aria-expanded={open}
            onClick={() => setManuallyOpen(!open)}
          >
            <span className={`preauth-caret${open ? " is-open" : ""}`}>›</span>
            <h2 className="label-eyebrow">Pre-auth form</h2>
          </button>
          {!isLoading ? (
            <span className="preauth-count">
              {confirmedCount} of {applicable.length} confirmed
            </span>
          ) : null}
        </div>
        <div className="preauth-head-right">
          {awaiting > 0 ? (
            <span className="chip chip--pending">{awaiting} to check</span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isBusy || data?.extractionAvailable === false}
            onClick={() => extract.mutate()}
          >
            {extract.isPending ? "Reading…" : "Read from documents"}
          </Button>
        </div>
      </div>

      {data?.extractionAvailable === false ? (
        // Honest about why, rather than a button that runs and finds
        // nothing — which reads as the feature being broken.
        <div className="field-source" style={{ marginTop: 4 }}>
          Reading documents needs an AI key configured. Fields can still be
          filled in by hand.
        </div>
      ) : null}

      {extract.isError ? (
        <div className="inline-error mt-3">
          Couldn&apos;t read the documents.
        </div>
      ) : null}

      {confirm.isError ? (
        <div className="inline-error mt-3">
          {confirm.error instanceof Error
            ? confirm.error.message
            : "Couldn't save that."}
        </div>
      ) : null}

      {extract.isSuccess && !extract.isPending ? (
        <div className="sent-confirm mt-3 flex-wrap">
          <span>
            {extract.data.documentsRead === 0
              ? "No confirmed documents to read yet — sort the uploads first."
              : extract.data.extracted === 0
                ? `Read ${extract.data.documentsRead} document${extract.data.documentsRead === 1 ? "" : "s"}, found nothing new to suggest.`
                : `Found ${extract.data.extracted} field${extract.data.extracted === 1 ? "" : "s"} across ${extract.data.documentsRead} document${extract.data.documentsRead === 1 ? "" : "s"} — check each before it goes on the form.`}
          </span>
        </div>
      ) : null}

      {open ? (
        <div className="preauth-groups">
          {PreauthFieldGroup.options.map((group) => {
            const fields = applicable.filter((f) => f.group === group);
            if (fields.length === 0) return null;
            return (
              <div key={group} className="preauth-group">
                <div className="preauth-group-label">
                  {PREAUTH_GROUP_LABEL[group]}
                </div>
                <div className="field-row">
                  {fields.map((field) => (
                    <PreauthField
                      key={field.key}
                      field={field}
                      row={byKey.get(field.key)}
                      isBusy={isBusy}
                      onConfirm={(value) =>
                        confirm.mutate({ fieldKey: field.key, value })
                      }
                      onClear={() => clear.mutate(field.key)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
