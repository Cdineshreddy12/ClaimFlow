import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { useDecide, useDoctorApproval } from "./api";

/**
 * Opened on a phone from a link, by a doctor with no account. Deliberately
 * not inside AppShell: there's no nav to offer, nothing else to reach, and
 * the chrome would only imply an app they can't sign into.
 */
export function DoctorApprovalPage() {
  const { token = "" } = useParams();
  const { data, isLoading, isError, error } = useDoctorApproval(token);
  const decide = useDecide(token);

  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  if (isLoading) {
    return (
      <div className="mx-auto max-w-md px-5 py-10">
        <Loader label="Opening the request…" />
      </div>
    );
  }

  if (isError || !data) {
    const message =
      error instanceof Error ? error.message : "This link isn't valid.";
    return (
      <div className="mx-auto max-w-md px-5 py-14 text-center">
        <h1 className="text-[17px] font-semibold">Link unavailable</h1>
        <p className="mt-2 text-[13.5px] text-ink-soft">{message}</p>
        <p className="mt-4 text-[12.5px] text-ink-faint">
          Ask the insurance desk to send a new one.
        </p>
      </div>
    );
  }

  if (decide.isSuccess) {
    return (
      <div className="mx-auto max-w-md px-5 py-14 text-center">
        <h1 className="text-[17px] font-semibold">Thank you</h1>
        <p className="mt-2 text-[13.5px] text-ink-soft">
          The insurance desk has your response for {data.patientName}. You can
          close this page.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 py-8">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
        {data.hospitalName}
      </div>
      <h1 className="mt-1 text-[19px] font-semibold -tracking-[0.01em]">
        Approve clinical notes
      </h1>
      <p className="mt-1.5 text-[13.5px] text-ink-soft">
        {data.doctorName}, the insurance desk needs your confirmation before
        this goes to {data.insurerName}.
      </p>

      <dl className="mt-6 rounded-lg border border-line bg-surface-raised px-4 py-3.5">
        {[
          ["Patient", data.patientName],
          ["Procedure", data.procedureName],
          ["Insurer / TPA", data.insurerName],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-1.5">
            <dt className="text-[12.5px] text-ink-faint">{label}</dt>
            <dd className="text-right text-[13.5px] font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
          Notes to review
        </div>
        {data.documents.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-faint">
            No clinical documents have been attached yet. Please ask the desk
            before approving.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {data.documents.map((doc) => (
              <li key={doc.slot}>
                <a
                  href={doc.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-raised px-3.5 py-3 text-[13.5px] font-medium text-ink"
                >
                  {doc.slot}
                  <span className="text-[12px] font-normal text-accent-ink">
                    Open
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {decide.isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical mt-5">
          Couldn&apos;t record that — check your connection and try again.
        </div>
      ) : null}

      {!declining ? (
        // Tall tap targets: this is a phone, often one-handed, often in a ward.
        <div className="mt-7 flex flex-col gap-2.5">
          <Button
            type="button"
            className="w-full py-3 text-[15px]"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ approved: true })}
          >
            {decide.isPending ? "Sending…" : "Approve these notes"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full py-3 text-[15px]"
            disabled={decide.isPending}
            onClick={() => setDeclining(true)}
          >
            Something needs changing
          </Button>
        </div>
      ) : (
        <form
          className="mt-7"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) {
              decide.mutate({ approved: false, reason: reason.trim() });
            }
          }}
        >
          <label
            htmlFor="reason"
            className="text-[12.5px] font-semibold text-ink-soft"
          >
            What needs changing?
          </label>
          <textarea
            id="reason"
            autoFocus
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. the ultrasound predates admission — a current one is needed"
            className="mt-1.5 w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2.5 text-[14px] text-ink"
          />
          <div className="mt-3 flex flex-col gap-2.5">
            <Button
              type="submit"
              className="w-full py-3 text-[15px]"
              disabled={!reason.trim() || decide.isPending}
            >
              {decide.isPending ? "Sending…" : "Send back to the desk"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full py-3 text-[15px]"
              disabled={decide.isPending}
              onClick={() => setDeclining(false)}
            >
              Back
            </Button>
          </div>
        </form>
      )}

      <p className="mt-6 text-center text-[12px] text-ink-faint">
        This link expires{" "}
        {new Date(data.expiresAt).toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </p>
    </div>
  );
}
