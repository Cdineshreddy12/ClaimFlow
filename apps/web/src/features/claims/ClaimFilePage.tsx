import { useParams } from "react-router-dom";
import { AppShell } from "../../app/AppShell";
import { ChecklistGapsCard } from "./ChecklistGapsCard";
import { Stepper } from "./Stepper";
import { UploadedDocumentsCard } from "./UploadedDocumentsCard";
import { useClaim, useClaimGaps } from "./api";
import { STATUS_CHIP_VARIANT, STATUS_LABEL } from "./types";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatAmount(value: string | null) {
  if (!value) return "—";
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

export function ClaimFilePage() {
  const { id = "" } = useParams();
  const { data: claim, isLoading, isError } = useClaim(id);
  const { data: gaps } = useClaimGaps(id);

  if (isLoading) {
    return (
      <AppShell title="Claim File">
        <p className="empty-state">Loading claim…</p>
      </AppShell>
    );
  }

  if (isError || !claim) {
    return (
      <AppShell title="Claim File">
        <div className="inline-error">Couldn't load this claim.</div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Claim File" subtitle={claim.id}>
      <div className="claim-head">
        <div>
          <div className="claim-id mono">{claim.id}</div>
          <div className="claim-title">{claim.patientName}</div>
          <div className="claim-meta">
            <span>{claim.procedureName}</span>
            <span>
              <b>{claim.insurerName}</b>
            </span>
            <span>
              Admitted{" "}
              <span className="mono">{formatDate(claim.admittedAt)}</span>
            </span>
          </div>
        </div>
        <span
          className={`chip chip--${STATUS_CHIP_VARIANT[claim.status]}`}
          style={{ padding: "6px 12px", fontSize: 13 }}
        >
          {STATUS_LABEL[claim.status]}
        </span>
      </div>

      <Stepper status={claim.status} />

      <div className="label-eyebrow" style={{ marginBottom: 10 }}>
        Claim details
      </div>
      <div className="field-row">
        <div className="field">
          <div className="field-label">Insurer / TPA</div>
          <div className="field-value">{claim.insurerName}</div>
        </div>
        <div className="field">
          <div className="field-label">Procedure</div>
          <div className="field-value">{claim.procedureName}</div>
        </div>
        <div className="field">
          <div className="field-label">Billed Amount</div>
          <div className="field-value mono">
            {formatAmount(claim.billedAmount)}
          </div>
        </div>
        <div className="field">
          <div className="field-label">Admission Date</div>
          <div className="field-value mono">{formatDate(claim.admittedAt)}</div>
        </div>
      </div>

      <div className="two-col">
        <ChecklistGapsCard claim={claim} gaps={gaps} />
        <UploadedDocumentsCard claim={claim} />
      </div>
    </AppShell>
  );
}
