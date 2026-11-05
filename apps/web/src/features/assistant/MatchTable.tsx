import type { AssistantAttachment } from "./types";

/**
 * What each dropped file matched, as a table.
 *
 * Rendered by the panel from the recogniser's own output rather than
 * asked of the model, because this is a lookup and not a judgement: the
 * claim, the confidence and the slot are already facts on the
 * attachment, and prose about them is a retelling that can drift. The
 * model's job is the part a table can't hold — why it matched, and what
 * to do about the ones that didn't.
 *
 * Four columns, because the drawer is a column and a fifth would mean
 * horizontal scrolling on every drop rather than the occasional one.
 */
export function MatchTable({
  attachments,
}: {
  attachments: AssistantAttachment[];
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-hover/40 text-left">
            <Th>File</Th>
            <Th>Matched claim</Th>
            <Th className="text-right">Sure</Th>
            <Th>Slot</Th>
          </tr>
        </thead>
        <tbody>
          {attachments.map((a) => {
            const claim = a.suggestedClaim;
            const confidence = a.claimConfidence
              ? Math.round(Number(a.claimConfidence) * 100)
              : null;
            return (
              <tr
                key={a.id}
                className="border-b border-line-divider last:border-b-0 align-top"
              >
                <Td className="font-medium [overflow-wrap:anywhere]">
                  {a.fileName}
                  {a.duplicateOf ? (
                    <div className="mt-0.5 text-2xs font-semibold text-pending">
                      {a.duplicateOf.kind === "same_file"
                        ? "Already filed"
                        : "Same name already on the claim"}
                    </div>
                  ) : null}
                </Td>
                <Td>
                  {claim ? (
                    <>
                      <span className="font-mono font-semibold tabular-nums">
                        {claim.reference ?? "—"}
                      </span>
                      <div className="text-2xs text-ink-faint">
                        {claim.patientName}
                      </div>
                    </>
                  ) : (
                    // The honest cell, and the one worth not dressing
                    // up: nothing on the page tied it to a claim.
                    <span className="text-pending">No match</span>
                  )}
                </Td>
                <Td className="text-right font-mono tabular-nums">
                  {confidence === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    <span className={confidence < 60 ? "text-pending" : ""}>
                      {confidence}%
                    </span>
                  )}
                </Td>
                <Td className="[overflow-wrap:anywhere]">
                  {a.suggestedSlot ?? <span className="text-ink-faint">—</span>}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-2 py-1.5 text-2xs font-semibold uppercase tracking-[0.05em] text-ink-faint ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-2 py-1.5 ${className}`}>{children}</td>;
}
