import { isTerminal, type ClaimStatus } from "@claimflow/contracts";
import { X } from "reicon-react";
import { CheckIcon } from "../../components/icons";

const STEP_ORDER = [
  "DRAFT",
  "PRE_AUTH_SENT",
  "QUERY_OR_ENHANCEMENT",
  "APPROVED",
  "FINAL_BILL_SUBMITTED",
  "DISCHARGE_AUTHORISED",
  "SETTLED",
] as const;

// "Discharged" rather than "Discharge authorised": on the line it sits
// between the bill and the money, where the only thing it can mean is
// that the insurer let the patient go.
const STEPS: { key: (typeof STEP_ORDER)[number]; name: string }[] = [
  { key: "PRE_AUTH_SENT", name: "Pre-auth sent" },
  { key: "QUERY_OR_ENHANCEMENT", name: "Query / Enhancement" },
  { key: "APPROVED", name: "Approved" },
  { key: "FINAL_BILL_SUBMITTED", name: "Final bill" },
  { key: "DISCHARGE_AUTHORISED", name: "Discharged" },
  { key: "SETTLED", name: "Settled" },
];

function normalize(status: ClaimStatus): (typeof STEP_ORDER)[number] {
  if (status === "QUERY_RAISED" || status === "ENHANCEMENT_REQUESTED")
    return "QUERY_OR_ENHANCEMENT";
  if (status === "REJECTED") return "DRAFT";
  return status;
}

/**
 * Where the claim has got to.
 *
 * Two things this gets right that the previous version didn't: an
 * upcoming step draws nothing rather than a tick — a tick means done,
 * and five of them on an untouched claim said the opposite of the
 * truth — and the connector fills up to the current step, so progress
 * is readable from the line alone without parsing five labels.
 */
export function Stepper({ status }: { status: ClaimStatus }) {
  if (status === "REJECTED") {
    return (
      <div className="my-1 mb-[26px] flex items-center gap-3 rounded-lg border border-critical bg-critical-bg px-4 py-[13px]">
        <span
          className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-critical text-base text-white"
          aria-hidden
        >
          <X size={14} />
        </span>
        <div>
          <div className="text-md font-semibold text-critical">Rejected</div>
          <div className="text-sm text-ink-soft">
            The insurer closed this claim. Record any deduction against it.
          </div>
        </div>
      </div>
    );
  }

  const currentIdx = STEP_ORDER.indexOf(normalize(status));
  const isQuery = status === "QUERY_RAISED";
  // Rejected returns above, so this is Settled: the end of the line.
  const finished = isTerminal(status);

  return (
    /*
      Stacked on narrow screens, one column per step from `sm` up. The
      old version drove this with grid-template-areas and a media query,
      which utilities can't express — laying each step out as a flex
      row that becomes a flex column at the breakpoint says the same
      thing with no CSS of its own.
    */
    <ol
      className="m-0 mb-[26px] mt-1 grid list-none grid-cols-1 p-0 sm:grid-flow-col sm:auto-cols-fr"
      aria-label="Claim progress"
    >
      {STEPS.map((step, i) => {
        const stepIdx = STEP_ORDER.indexOf(step.key);
        const state =
          stepIdx < currentIdx
            ? "done"
            : stepIdx === currentIdx
              ? // A settled claim is finished, not mid-step. Marking the
                // last one "current" put an amber "In progress" under
                // "Settled" — the claim is closed and the stepper was
                // saying there was work left on it.
                finished
                ? "done"
                : "current"
              : "upcoming";
        // The segment to this step's left is complete when everything
        // before it is — which includes the run up to the current step.
        const trackFilled = i > 0 && stepIdx <= currentIdx;
        const critical = state === "current" && isQuery;

        return (
          <li
            key={step.key}
            className="relative grid grid-cols-[28px_1fr] items-start gap-x-3 gap-y-0 pb-5 text-left last:pb-0 sm:flex sm:flex-col sm:items-center sm:gap-[9px] sm:px-1 sm:pb-0 sm:text-center"
            aria-current={state === "current" ? "step" : undefined}
          >
            {i > 0 ? (
              /* Vertical when stacked, horizontal once side by side. */
              <span
                aria-hidden
                className={`absolute z-0 rounded-[1px] bottom-1/2 left-[13px] h-full w-0.5 sm:bottom-auto sm:left-auto sm:right-1/2 sm:top-[13px] sm:h-0.5 sm:w-full ${
                  trackFilled ? "bg-approved" : "bg-line"
                }`}
              />
            ) : null}

            <span
              className={`relative z-[1] flex size-7 items-center justify-center rounded-full border-2 bg-surface-raised ${
                state === "done"
                  ? "border-approved bg-approved text-white"
                  : state === "current"
                    ? critical
                      ? "border-critical shadow-[0_0_0_4px_var(--critical-bg)]"
                      : "border-pending shadow-[0_0_0_4px_var(--pending-bg)]"
                    : "border-line"
              }`}
            >
              {state === "done" ? <CheckIcon size={12} /> : null}
              {/* The inner dot the old rule drew with ::after. */}
              {state === "current" ? (
                <span
                  aria-hidden
                  className={`size-2.5 rounded-full ${critical ? "bg-critical" : "bg-pending"}`}
                />
              ) : null}
              {state === "upcoming" ? (
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-line-strong"
                />
              ) : null}
            </span>

            <span
              className={`text-sm leading-tight ${
                state === "upcoming"
                  ? "font-medium text-ink-faint"
                  : "font-semibold text-ink"
              }`}
            >
              {step.name}
            </span>
            {/* Upcoming steps say nothing. An em dash under every future
                stage is four lines of noise saying "not yet", which the
                dimmed label already says. */}
            {state !== "upcoming" ? (
              <span
                className={`col-start-2 text-xs sm:col-start-auto ${
                  state === "done"
                    ? "text-approved"
                    : critical
                      ? "font-semibold text-critical"
                      : "font-semibold text-pending"
                }`}
              >
                {state === "current"
                  ? isQuery
                    ? "Waiting on us"
                    : "In progress"
                  : "Done"}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
