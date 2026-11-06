import { placementLabel } from "@claimflow/contracts";
import { preauthProgress } from "../preauth/progress";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  useClearPreauthField,
  useConfirmPreauthField,
  useExtractPreauthFields,
  usePreauthFields,
} from "../preauth/api";
import { useClaimLayout } from "../preauth/layout-api";
import { PreauthField } from "./PreauthField";
import type { Claim } from "./types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * The hospital's half of the IRDAI pre-auth form, filled from the
 * claim's confirmed documents.
 *
 * This is the retyping the brief is about: a diagnosis, an ICD code, an
 * admission date and eight cost lines copied out of a doctor's note by
 * hand, per admission. Reading them is one click; none of them land
 * until a human confirms (docs/adr/0005).
 *
 * It lives behind its own tab on the claim file: twenty-four fields
 * underneath the checklist pushed the gap view — the thing the brief
 * says must be readable without scrolling — off the screen. The tab
 * carries the outstanding count so moving it out of sight doesn't move
 * it out of mind.
 */
export function PreauthFieldsCard({ claim }: { claim: Claim }) {
  const { data, isLoading } = usePreauthFields(claim.id);
  // The claim's frozen layout, never the live one — editing the form
  // must not change what an in-flight claim appears to have asked for
  // (docs/adr/0001).
  const { data: layout, isLoading: layoutLoading } = useClaimLayout(claim.id);
  const extract = useExtractPreauthFields(claim.id);
  const confirm = useConfirmPreauthField(claim.id);
  const clear = useClearPreauthField(claim.id);

  const rows = data?.fields ?? [];
  const byKey = new Map(rows.map((r) => [r.fieldKey, r]));

  const {
    sections,
    applicable,
    confirmed: confirmedCount,
    awaiting,
  } = preauthProgress({ layout, fields: data?.fields });

  const isBusy = confirm.isPending || clear.isPending || extract.isPending;

  return (
    <Card className="mt-[22px]">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-2.5">
          <CardTitle>Pre-auth form</CardTitle>
          {!isLoading && !layoutLoading ? (
            <span className="text-sm text-ink-faint">
              {confirmedCount} of {applicable.length} confirmed
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-2.5">
          {awaiting > 0 ? (
            <Badge variant="pending">{awaiting} to check</Badge>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy || data?.extractionAvailable === false}
            onClick={() => extract.mutate()}
          >
            {extract.isPending ? "Reading…" : "Read from documents"}
          </Button>
        </div>
      </CardHeader>

      {data?.extractionAvailable === false ? (
        // Honest about why, rather than a button that runs and finds
        // nothing — which reads as the feature being broken.
        <div className="text-xs text-ink-faint" style={{ marginTop: 4 }}>
          Reading documents needs an AI key configured. Fields can still be
          filled in by hand.
        </div>
      ) : null}

      {extract.isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical mt-3">
          Couldn&apos;t read the documents.
        </div>
      ) : null}

      {confirm.isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical mt-3">
          {confirm.error instanceof Error
            ? confirm.error.message
            : "Couldn't save that."}
        </div>
      ) : null}

      {extract.isSuccess && !extract.isPending ? (
        <div className="flex items-center gap-[9px] rounded-md border border-approved bg-approved-bg px-3.5 py-3 text-base text-ink mt-3 flex-wrap">
          <span>
            {extract.data.documentsRead === 0
              ? "No confirmed documents to read yet — sort the uploads first."
              : extract.data.extracted === 0
                ? `Read ${extract.data.documentsRead} document${extract.data.documentsRead === 1 ? "" : "s"}, found nothing new to suggest.`
                : `Found ${extract.data.extracted} field${extract.data.extracted === 1 ? "" : "s"} across ${extract.data.documentsRead} document${extract.data.documentsRead === 1 ? "" : "s"} — check each before it goes on the form.`}
          </span>
        </div>
      ) : null}

      <div className="mt-[18px]">
        {layoutLoading ? <Loader label="Loading the form…" /> : null}
        {!layoutLoading && sections.length === 0 ? (
          <p className="px-1 py-2.5 text-base text-ink-faint">
            This claim&apos;s form has no fields on it. Add some under Checklist
            Admin → Pre-auth form.
          </p>
        ) : null}
        {sections.map((section) => {
          // Two columns when the layout says so, one list otherwise.
          // Each column keeps its own ordered list rather than one
          // row-major grid, so a field's bottom rule still disappears
          // at the end of its own column — and so a narrow screen
          // stacks into two readable lists instead of interleaving
          // them.
          const columns =
            section.columnCount === 2
              ? [
                  section.placements.filter((p) => p.columnPosition !== 1),
                  section.placements.filter((p) => p.columnPosition === 1),
                ].filter((column) => column.length > 0)
              : [section.placements];

          return (
            <div key={section.id} className="[&+&]:mt-1.5">
              <div className="mb-[9px] text-sm font-semibold text-ink-soft">
                {section.name}
              </div>
              <div
                className={`mb-5 grid items-start gap-4 ${
                  columns.length === 2 ? "lg:grid-cols-2" : "grid-cols-1"
                }`}
              >
                {columns.map((column, index) => (
                  <div
                    key={index}
                    className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line"
                  >
                    {column.map((placement) => (
                      <PreauthField
                        key={placement.id}
                        claimId={claim.id}
                        field={{
                          key: placement.definition.fieldKey,
                          label: placementLabel(placement),
                          type: placement.definition.fieldType,
                          hint: placement.definition.hint,
                          options: placement.definition.options,
                          required: placement.required,
                        }}
                        row={byKey.get(placement.definition.fieldKey)}
                        isBusy={isBusy}
                        layout={columns.length === 2 ? "stacked" : "row"}
                        onConfirm={(value) =>
                          confirm.mutate({
                            fieldKey: placement.definition.fieldKey,
                            value,
                          })
                        }
                        onClear={() =>
                          clear.mutate(placement.definition.fieldKey)
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
