import type { ClaimStatus } from "@claimflow/contracts";
import { CheckIcon, DotIcon } from "../../components/icons";

const STEP_ORDER = [
  "DRAFT",
  "PRE_AUTH_SENT",
  "QUERY_OR_ENHANCEMENT",
  "APPROVED",
  "FINAL_BILL_SUBMITTED",
  "SETTLED",
] as const;

const STEPS: { key: (typeof STEP_ORDER)[number]; name: string }[] = [
  { key: "PRE_AUTH_SENT", name: "Pre-auth sent" },
  { key: "QUERY_OR_ENHANCEMENT", name: "Query / Enhancement" },
  { key: "APPROVED", name: "Approved" },
  { key: "FINAL_BILL_SUBMITTED", name: "Final bill" },
  { key: "SETTLED", name: "Settled" },
];

function normalize(status: ClaimStatus): (typeof STEP_ORDER)[number] {
  if (status === "QUERY_RAISED" || status === "ENHANCEMENT_REQUESTED")
    return "QUERY_OR_ENHANCEMENT";
  if (status === "REJECTED") return "DRAFT";
  return status;
}

export function Stepper({ status }: { status: ClaimStatus }) {
  if (status === "REJECTED") {
    return (
      <div
        className="chip chip--critical"
        style={{ marginBottom: 22, padding: "8px 14px", fontSize: 13 }}
      >
        Rejected
      </div>
    );
  }

  const currentIdx = STEP_ORDER.indexOf(normalize(status));

  return (
    <div className="stepper">
      {STEPS.map((step) => {
        const stepIdx = STEP_ORDER.indexOf(step.key);
        const state =
          stepIdx < currentIdx
            ? "done"
            : stepIdx === currentIdx
              ? "current"
              : "upcoming";
        const critical = state === "current" && status === "QUERY_RAISED";
        return (
          <div
            key={step.key}
            className={`step ${state}${state === "done" ? " line-done" : ""}${critical ? " critical" : ""}`}
          >
            <div className="step-node">
              {state === "done" ? (
                <CheckIcon size={14} />
              ) : state === "current" ? (
                <DotIcon size={14} />
              ) : (
                <CheckIcon size={14} />
              )}
            </div>
            <div className="step-name">{step.name}</div>
            <div className="step-time">
              {state === "upcoming"
                ? "—"
                : state === "current"
                  ? "In progress"
                  : "Done"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
