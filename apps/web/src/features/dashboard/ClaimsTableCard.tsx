import { Link } from "react-router-dom";
import { formatDuration } from "../../lib/format";
import { STATUS_CHIP_VARIANT, STATUS_LABEL } from "../claims/types";
import type { Claim } from "../claims/types";

function stageTimeClass(claim: Claim): string {
  if (claim.status === "QUERY_RAISED") return "is-critical";
  if (
    claim.status === "PRE_AUTH_SENT" ||
    claim.status === "ENHANCEMENT_REQUESTED"
  )
    return "is-pending";
  return "";
}

export function ClaimsTableCard({
  claims,
  now,
}: {
  claims: Claim[];
  now: number;
}) {
  return (
    <div className="card card-pad">
      <div className="card-head">
        <h2 className="label-eyebrow">All Claims</h2>
      </div>

      {claims.length === 0 ? (
        <p className="empty-state">No claims yet.</p>
      ) : (
        <table className="claims-table">
          <thead>
            <tr>
              <th>Claim</th>
              <th>Patient</th>
              <th>Insurer / TPA</th>
              <th>Status</th>
              <th>Time in Stage</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr key={claim.id}>
                <td className="mono">
                  <Link
                    to={`/claims/${claim.id}`}
                    style={{
                      color: "var(--accent-ink)",
                      textDecoration: "none",
                    }}
                  >
                    {claim.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="patient-cell">
                  {claim.patientName}
                  <span className="proc">{claim.procedureName}</span>
                </td>
                <td>{claim.insurerName}</td>
                <td>
                  <span
                    className={`chip chip--${STATUS_CHIP_VARIANT[claim.status]}`}
                  >
                    {STATUS_LABEL[claim.status]}
                  </span>
                </td>
                <td className={`mono stage-time ${stageTimeClass(claim)}`}>
                  {formatDuration(now - new Date(claim.updatedAt).getTime())}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
