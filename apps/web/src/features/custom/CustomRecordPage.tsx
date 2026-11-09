import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { validateRecord, type CustomField } from "@claimflow/contracts";
import { AppShell } from "@/app/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { ApiError } from "@/lib/api-client";
import { useCreateRecord, useCustomRecords, useUpdateRecord } from "./api";
import { RecordFields } from "./RecordFields";

/**
 * One record of one custom module, on its own page.
 *
 * Both halves of the job — adding and editing — because they are the
 * same form against the same fields, and splitting them would mean two
 * copies of the validation wiring. `/m/:slug/new` has no record id;
 * `/m/:slug/:recordId` loads one.
 */
export function CustomRecordPage() {
  const { slug = "", recordId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useCustomRecords(slug);
  const create = useCreateRecord(slug);
  const update = useUpdateRecord(slug);

  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);

  if (isLoading) {
    return (
      <AppShell title="Loading…">
        <Loader label="Loading the form…" />
      </AppShell>
    );
  }

  const module = data?.module;
  const existing = recordId
    ? data?.records.find((r) => r.id === recordId)
    : undefined;

  if (isError || !module || (recordId && !existing)) {
    return (
      <AppShell title="Not found">
        <div className="py-10 text-center">
          <h1 className="text-xl font-semibold">That isn&apos;t here</h1>
          <p className="mx-auto mt-2 max-w-sm text-base text-ink-soft">
            It may have been renamed or removed.
          </p>
          <div className="mt-6 flex justify-center">
            <Button asChild variant="outline">
              <Link to={`/m/${slug}`}>Back to the list</Link>
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  // Seeded once from whatever is being edited, then owned by the form.
  const values = draft ?? existing?.data ?? {};
  const errors = validateRecord(module.fields, values);
  const busy = create.isPending || update.isPending;

  function errorFor(field: CustomField) {
    return (
      serverErrors[field.fieldKey] ??
      (touched
        ? errors.find((e) => e.fieldKey === field.fieldKey)?.message
        : undefined)
    );
  }

  /** The API's per-field complaints, keyed so each shows against its own input. */
  function onError(err: unknown) {
    if (err instanceof ApiError && err.fields) {
      setServerErrors(
        Object.fromEntries(err.fields.map((f) => [f.fieldKey, f.message])),
      );
      setFailed(null);
      return;
    }
    setFailed(err instanceof Error ? err.message : "Couldn't save that.");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setServerErrors({});
    setFailed(null);
    if (errors.length > 0) return;

    const done = () => navigate(`/m/${slug}`);
    if (existing) {
      update.mutate(
        { id: existing.id, data: values },
        { onSuccess: done, onError },
      );
    } else {
      create.mutate(values, { onSuccess: done, onError });
    }
  }

  return (
    <AppShell
      title={
        existing
          ? `Edit ${module.name.toLowerCase()}`
          : `New ${module.name.toLowerCase()}`
      }
      subtitle={module.pluralName}
    >
      {/* Centred: a form this narrow pinned to the left edge of a wide
          desk monitor leaves the reader's eye travelling across empty
          space to reach it. */}
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle>
            {existing
              ? `Edit ${module.name.toLowerCase()}`
              : `New ${module.name.toLowerCase()}`}
          </CardTitle>
        </CardHeader>

        {module.description ? (
          <p className="m-0 mb-4 text-base text-ink-soft">
            {module.description}
          </p>
        ) : null}

        {failed ? (
          <div className="mb-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
            {failed}
          </div>
        ) : null}

        {module.fields.length === 0 ? (
          <p className="m-0 py-2 text-base text-ink-faint">
            This module has no fields yet. Add some in{" "}
            <Link to="/checklist" className="text-accent-ink underline">
              Checklist Admin → Modules
            </Link>{" "}
            before recording anything against it.
          </p>
        ) : (
          <form
            onSubmit={submit}
            // The contract is the only authority on what a field
            // accepts. Left to itself the browser runs its own rules
            // first and refuses to fire submit at all — an
            // `<input type="email">` holding "ravi at example.com"
            // silently swallowed the click, and the message the form
            // and the server agree on never got a chance to render.
            noValidate
          >
            <RecordFields
              fields={module.fields}
              data={values}
              onChange={(fieldKey, value) =>
                setDraft({ ...values, [fieldKey]: value })
              }
              errorFor={errorFor}
            />

            <div className="mt-2 flex justify-end gap-2.5 border-t border-line pt-4">
              <Button asChild type="button" variant="outline">
                <Link to={`/m/${slug}`}>Cancel</Link>
              </Button>
              <Button type="submit" disabled={busy}>
                {busy
                  ? "Saving…"
                  : existing
                    ? "Save changes"
                    : `Add ${module.name.toLowerCase()}`}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </AppShell>
  );
}
