import { CheckIcon, CrossIcon } from "../../components/icons";
import type { Claim, ClaimGaps } from "./types";

export function ChecklistGapsCard({
  claim,
  gaps,
}: {
  claim: Claim;
  gaps: ClaimGaps | undefined;
}) {
  const requiredMissing = gaps?.missing.length ?? 0;

  return (
    <div className="card card-pad">
      <div className="card-head">
        <h2 className="label-eyebrow">Document Checklist · Gaps</h2>
        {gaps ? (
          <span
            className={`chip ${requiredMissing > 0 ? "chip--critical" : "chip--approved"}`}
          >
            {requiredMissing > 0 ? `${requiredMissing} missing` : "Complete"}
          </span>
        ) : null}
      </div>

      {claim.checklistSnapshot.length === 0 ? (
        <p className="empty-state">
          No checklist rules applied when this claim was opened.
        </p>
      ) : (
        <div className="checklist">
          {claim.checklistSnapshot.map((item) => {
            const present =
              gaps?.satisfied.includes(item.documentType) ?? false;
            const missing = item.required && !present;
            return (
              <div
                key={item.documentType}
                className={`doc-item${missing ? " is-missing" : ""}`}
              >
                <div
                  className={`doc-status ${present ? "present" : item.required ? "missing" : "optional"}`}
                >
                  {present ? (
                    <CheckIcon />
                  ) : item.required ? (
                    <CrossIcon />
                  ) : null}
                </div>
                <div className="doc-name">{item.documentType}</div>
                <div className="doc-req">
                  {present
                    ? "Confirmed"
                    : item.required
                      ? "Missing"
                      : "Optional"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
