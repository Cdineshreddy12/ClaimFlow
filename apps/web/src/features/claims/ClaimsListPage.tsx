import { Link } from "react-router-dom";
import { AppShell } from "../../app/AppShell";
import { useClaims } from "./api";
import { STATUS_CHIP_VARIANT, STATUS_LABEL } from "./types";

export function ClaimsListPage() {
  const { data: claims, isLoading, isError } = useClaims();

  return (
    <AppShell title="Claims" subtitle="Across the cashless desk">
      <div className="card card-pad">
        {isLoading ? <p className="empty-state">Loading…</p> : null}
        {isError ? (
          <div className="inline-error">Couldn't load claims.</div>
        ) : null}
        {claims && claims.length === 0 ? (
          <p className="empty-state">No claims yet.</p>
        ) : null}

        {claims && claims.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Claim</th>
                <th>Patient</th>
                <th>Insurer / TPA</th>
                <th>Status</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </AppShell>
  );
}
