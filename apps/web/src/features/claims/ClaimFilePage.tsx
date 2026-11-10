import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AppShell } from "../../app/AppShell";
import { Loader } from "../../components/ui/loader";
import { Tabs, type TabDef } from "../../components/ui/tabs";
import { formatAdmission } from "../../lib/format";
import { usePreauthFields } from "../preauth/api";
import { useClaimLayout } from "../preauth/layout-api";
import { preauthProgress } from "../preauth/progress";
import { ClaimDocumentsTab } from "./ClaimDocumentsTab";
import { DeductionsCard } from "./DeductionsCard";
import { FormReviewCard } from "./FormReviewCard";
import { MoneyCard } from "./MoneyCard";
import { ClaimSummaryRail } from "./ClaimSummaryRail";
import { PreauthFieldsCard } from "./PreauthFieldsCard";
import { Stepper } from "./Stepper";
import { SlaClock } from "../sla/SlaClock";
import { useClaim, useClaimFinancials, useClaimGaps } from "./api";
import { STATUS_CHIP_VARIANT, STATUS_LABEL } from "./types";
import { Badge } from "@/components/ui/badge";

/**
 * One admission's file.
 *
 * Organised as a workspace rather than a document: a header that states
 * the claim once, a tabbed body for the two jobs a desk actually does
 * here (chase documents, fill the pre-auth form), and a rail holding
 * the facts and the next action.
 *
 * The tabs exist because the pre-auth form is twenty-four fields. Laid
 * out flat underneath the checklist it pushed the gap view — the thing
 * the brief says must be visible without scrolling — off the screen
 * entirely. Counts sit on the tab labels so moving work out of sight
 * doesn't move it out of mind.
 */
export function ClaimFilePage() {
  const { id = "" } = useParams();
  const { data: claim, isLoading, isError } = useClaim(id);
  const { data: gaps } = useClaimGaps(id);
  const { data: preauth } = usePreauthFields(id);
  const { data: layout, isPending: layoutPending } = useClaimLayout(id);
  const { data: money } = useClaimFinancials(id);
  const [tab, setTab] = useState("documents");

  /*
    How far down the rail has to pin.

    The claim header above is sticky and opaque and spans the full width
    of the page, rail included. A rail pinned at the top of the viewport
    therefore parks its first card *behind* that header — which reads as
    the rail having slid down the page, because the only part of it you
    can see starts below the header's bottom edge.

    Measured rather than hard-coded: the header carries the patient's
    name, a meta row that wraps, and the stepper, so its height changes
    with the window and with the claim. A constant would be wrong at
    some width, and wrong in the direction that hides content.
  */
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const header = headerRef.current;
    if (!header || typeof ResizeObserver === "undefined") return;
    const measure = () => setHeaderHeight(header.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
    // Re-runs once the claim arrives, which is when the header first
    // exists to measure.
  }, [claim]);

  if (isLoading) {
    return (
      <AppShell title="Claim File" back={{ to: "/claims", label: "Claims" }}>
        <Loader label="Loading claim…" />
      </AppShell>
    );
  }

  if (isError || !claim) {
    return (
      <AppShell title="Claim File" back={{ to: "/claims", label: "Claims" }}>
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          Couldn&apos;t load this claim.
        </div>
      </AppShell>
    );
  }

  const missing = gaps?.missing.length ?? 0;
  // The same count the card itself shows, off the claim's own frozen
  // layout — not the global field catalogue, which ignores whatever the
  // hospital built in the form builder.
  const { applicable, confirmed, awaiting } = preauthProgress({
    layout,
    fields: preauth?.fields,
  });
  const admitted = claim.admittedAt ? formatAdmission(claim.admittedAt) : null;

  const tabs: TabDef[] = [
    {
      id: "documents",
      label: "Documents",
      // A claim with no rules can never report anything missing, so an
      // absent badge here would read as a clean file rather than an
      // unchecked one.
      ...(claim.checklistSnapshot.length === 0
        ? { badge: "Not checked", badgeTone: "pending" as const }
        : missing > 0
          ? { badge: `${missing} missing`, badgeTone: "critical" as const }
          : {}),
    },
    {
      id: "money",
      label: "Money",
      // The badge is the one thing on this tab that can't wait: a claim
      // whose cost is about to outgrow its sanction needs an
      // enhancement before discharge, not after.
      ...(money?.enhancement.advised
        ? { badge: "Needs cover", badgeTone: "critical" as const }
        : money?.shortfall
          ? { badge: "Short", badgeTone: "pending" as const }
          : {}),
    },
    {
      id: "preauth",
      label: "Pre-auth form",
      // The number that matters changes with the state: unchecked
      // suggestions are urgent, otherwise it's just progress.
      //
      // No badge at all until the layout has arrived. The denominator
      // comes from it, so counting early renders "0/0" on a form that
      // is 23 of 25 done — a false zero reads as "nothing here", which
      // is worse than a label that appears a moment later.
      ...(layoutPending
        ? {}
        : {
            badge:
              awaiting > 0
                ? `${awaiting} to check`
                : `${confirmed}/${applicable.length}`,
            badgeTone:
              awaiting > 0 ? ("pending" as const) : ("neutral" as const),
          }),
    },
  ];

  return (
    <AppShell
      title="Claim File"
      subtitle={claim.reference}
      back={{ to: "/claims", label: "Claims" }}
    >
      {/* Pinned: which patient, which insurer and what stage are the
          facts you need while scrolling a long document list or a
          twenty-four-field form. */}
      {/* No negative top margin at `lg`, which is what hid "Back to
          Claims". The shell renders that link at the top of the main
          column; this header cancelled the column's top padding to sit
          flush, which pulled it up over the link — and being opaque, it
          painted it out entirely. A claim opened from the list had no
          way back on screen.

          It still pins flush when you scroll, because `top-0` decides
          that, not the margin. On a phone the margin stays: the header
          is static there, the shell's link is hidden, and the back
          chevron lives in the top bar instead. */}
      <div
        ref={headerRef}
        className="static z-10 -mx-4 -mt-5 mb-4 border-b border-line bg-surface-raised px-4 pb-1 pt-4 lg:sticky lg:top-0 lg:-mx-8 lg:mt-0 lg:mb-[18px] lg:px-8 lg:pb-1.5 lg:pt-[22px]"
      >
        <div className="mb-[22px] block gap-4 md:flex md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="mb-1 text-sm text-ink-faint font-mono tabular-nums">
              {claim.reference}
            </div>
            <div className="text-2xl font-semibold tracking-[-0.01em]">
              {claim.patientName}
            </div>
            {/* Said once, here. The old "Claim details" strip below
                repeated all of this and added only the billed amount. */}
            {/* One fact per line on a phone, with no separators at all:
                three of these never fit on one line at 360px, and a
                wrapped row leaves a "·" stranded — trailing one line or
                leading the next, both of which read as a typo. From
                `sm` the row fits, and the separator rides on the item
                after it so a wrap still can't orphan one. */}
            <div className="mt-2 flex flex-col gap-1 text-base text-ink-soft sm:flex-row sm:flex-wrap sm:items-center sm:[&>*+*]:before:mx-2.5 sm:[&>*+*]:before:text-ink-faint sm:[&>*+*]:before:content-['\00B7'] [&_b]:font-semibold [&_b]:text-ink">
              <span>{claim.procedureName}</span>
              <span>
                <b>{claim.insurerName}</b>
              </span>
              {admitted ? (
                <span>
                  Admitted{" "}
                  <span className="font-mono tabular-nums">{admitted}</span>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_CHIP_VARIANT[claim.status]}>
              {STATUS_LABEL[claim.status]}
            </Badge>
            <SlaClock status={claim.status} deadline={claim.slaDeadline} />
          </div>
        </div>

        <Stepper status={claim.status} />
      </div>

      <div
        className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]"
        style={
          { "--rail-top": `${headerHeight + 20}px` } as React.CSSProperties
        }
      >
        <div className="min-w-0">
          <Tabs tabs={tabs} active={tab} onChange={setTab}>
            {tab === "documents" ? (
              <ClaimDocumentsTab claim={claim} gaps={gaps} />
            ) : tab === "money" ? (
              <div className="flex flex-col gap-[18px]">
                <MoneyCard claim={claim} />
                <DeductionsCard claim={claim} />
              </div>
            ) : (
              <div className="flex flex-col gap-[18px]">
                {/* Above the form, not below it: its whole job is to be
                    read before someone clicks send, and a panel under
                    twenty-four fields is a panel nobody scrolls to. */}
                <FormReviewCard claim={claim} />
                <PreauthFieldsCard claim={claim} />
              </div>
            )}
          </Tabs>
        </div>
        <ClaimSummaryRail claim={claim} gaps={gaps} />
      </div>
    </AppShell>
  );
}
