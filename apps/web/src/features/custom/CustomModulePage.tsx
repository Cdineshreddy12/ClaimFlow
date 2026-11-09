import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CustomRecord } from "@claimflow/contracts";
import { AppShell } from "@/app/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Loader } from "@/components/ui/loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCustomRecords, useDeleteRecord } from "./api";
import { formatValue } from "./format";

/**
 * One custom module's records.
 *
 * Every module in the product shares this page — the columns come from
 * the module's own fields, which is why there is one route
 * (`/m/:slug`) rather than a page per module.
 *
 * Adding and editing live at their own addresses rather than in a
 * dialog over this table. A record can carry twenty fields, and that
 * is a page: it can be linked to, reloaded, and backed out of.
 */
export function CustomModulePage() {
  const { slug = "" } = useParams();
  const { data, isLoading, isError } = useCustomRecords(slug);
  const remove = useDeleteRecord(slug);
  const [confirming, setConfirming] = useState<CustomRecord | null>(null);

  if (isLoading) {
    return (
      <AppShell title="Loading…">
        <Loader label="Loading records…" />
      </AppShell>
    );
  }

  if (isError || !data) {
    return (
      <AppShell title="Not found">
        <div className="py-10 text-center">
          <h1 className="text-xl font-semibold">That module isn&apos;t here</h1>
          <p className="mx-auto mt-2 max-w-sm text-base text-ink-soft">
            It may have been renamed or removed.
          </p>
          <div className="mt-6 flex justify-center">
            <Button asChild variant="outline">
              <Link to="/checklist">Back to Checklist Admin</Link>
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const { module, records } = data;
  const columns = module.fields.filter((f) => f.showInList);

  return (
    <AppShell
      title={module.pluralName}
      subtitle={module.description ?? "A module this hospital defined"}
    >
      <Card>
        <CardHeader>
          <CardTitle>{module.pluralName}</CardTitle>
          <Button asChild>
            <Link to={`/m/${slug}/new`}>Add {module.name.toLowerCase()}</Link>
          </Button>
        </CardHeader>

        {records.length === 0 ? (
          <p className="px-1 py-2.5 text-base text-ink-faint">
            Nothing recorded yet.{" "}
            {module.fields.length === 0 ? (
              <>
                This module has no fields — add some in{" "}
                <Link to="/checklist" className="text-accent-ink underline">
                  Checklist Admin → Modules
                </Link>{" "}
                first.
              </>
            ) : (
              `Add the first ${module.name.toLowerCase()} to start.`
            )}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((field) => (
                  <TableHead key={field.id}>{field.label}</TableHead>
                ))}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  {columns.map((field) => (
                    <TableCell key={field.id}>
                      {formatValue(field, record.data[field.fieldKey])}
                    </TableCell>
                  ))}
                  <TableCell className="flex justify-end gap-1 whitespace-nowrap">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/m/${slug}/${record.id}`}>Edit</Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirming(record)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* A dialog is right here and wrong for the form: this asks one
          irreversible question, which is what a modal is actually for. */}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Delete this ${module.name.toLowerCase()}?`}
        description="It comes off the list for good. Nothing else refers to it, so nothing breaks."
        confirmLabel="Delete it"
        busy={remove.isPending}
        onConfirm={() =>
          confirming &&
          remove.mutate(confirming.id, { onSuccess: () => setConfirming(null) })
        }
      />
    </AppShell>
  );
}
