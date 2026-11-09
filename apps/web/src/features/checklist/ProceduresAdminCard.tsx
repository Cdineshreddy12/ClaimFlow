import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateProcedure,
  useDeleteProcedure,
  useProcedures,
  useSetProcedureActive,
  useUpdateProcedure,
  type Procedure,
} from "./api";

/**
 * The procedures this hospital files claims for.
 *
 * The other half of the key a checklist hangs on, and until now the
 * half nobody could edit — the list was whatever the seed file
 * shipped, so a hospital could not open a claim for a procedure it
 * actually performs. Insurers had a master a desk maintains from the
 * start; this is the matching one.
 *
 * Same shape as that card on purpose: a desk head who has learnt one
 * of these two screens has learnt both.
 */
export function ProceduresAdminCard({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  // The one caller that wants the retired rows: it is the screen that
  // puts them back.
  const { data: procedures, isLoading, isError } = useProcedures(true);
  const [showRetired, setShowRetired] = useState(false);
  const create = useCreateProcedure();
  const update = useUpdateProcedure();
  const remove = useDeleteProcedure();
  const setActive = useSetProcedureActive();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Procedure | null>(
    null,
  );

  const busy =
    create.isPending ||
    update.isPending ||
    remove.isPending ||
    setActive.isPending;

  function reset() {
    setEditingId(null);
    setName("");
    setCode("");
    setError(null);
  }

  function startEdit(procedure: Procedure) {
    setEditingId(procedure.id);
    setName(procedure.name);
    setCode(procedure.code ?? "");
    setShowForm(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), code: code.trim() };
    if (!body.name) return;
    setError(null);
    try {
      if (editingId) {
        await update.mutateAsync({ id: editingId, ...body });
      } else {
        await create.mutateAsync(body);
      }
      // Cleared but left open after an add, the way the insurer form
      // next door behaves: a hospital sets this list up in one sitting,
      // and closing after each one made it five clicks per procedure.
      // An edit is a single correction, so that does close.
      const wasEdit = Boolean(editingId);
      reset();
      if (wasEdit) setShowForm(false);
    } catch (err) {
      // The API says what went wrong — a duplicate name, usually — and
      // that is more use than "couldn't save".
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    }
  }

  async function onDelete(procedure: Procedure) {
    setError(null);
    setConfirmingDelete(null);
    try {
      await remove.mutateAsync(procedure.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't delete that procedure.",
      );
    }
  }

  // One form, two homes — above the table when adding, in the row's own
  // place when editing, so the fields appear where the click happened.
  const form = (
    <form
      className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center [&>*:first-child]:sm:flex-[2_1_240px] [&>*:nth-child(2)]:sm:flex-[0_1_140px]"
      onSubmit={submit}
    >
      <Input
        aria-label="Procedure name"
        placeholder="e.g. Laparoscopic appendicectomy"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        aria-label="Short code"
        placeholder="Code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Button type="submit" disabled={!name.trim() || busy}>
        {editingId ? "Save" : "Add"}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          reset();
          setShowForm(false);
        }}
      >
        Cancel
      </Button>
    </form>
  );

  if (isLoading) return <Loader label="Loading procedures…" />;
  if (isError) {
    return (
      <div className="mb-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
        Couldn&apos;t load the procedures.
      </div>
    );
  }

  const rows = (procedures ?? []).filter((p) => showRetired || p.isActive);
  const retiredCount = (procedures ?? []).filter((p) => !p.isActive).length;

  return (
    <Card>
      <ConfirmDialog
        open={confirmingDelete !== null}
        onOpenChange={(open) => !open && setConfirmingDelete(null)}
        title={`Delete ${confirmingDelete?.name ?? ""}?`}
        description="It comes off the list for good. Nothing is filed against it, so nothing breaks — but if you only want it off the picker, Retire keeps the record."
        confirmLabel="Delete it"
        busy={remove.isPending}
        onConfirm={() => confirmingDelete && onDelete(confirmingDelete)}
      />

      <CardHeader>
        <CardTitle>Procedures</CardTitle>
        <div className="flex items-center gap-3">
          {retiredCount > 0 ? (
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] font-semibold text-accent-ink underline"
              onClick={() => setShowRetired((v) => !v)}
            >
              {showRetired ? "Hide retired" : `Show ${retiredCount} retired`}
            </button>
          ) : null}
          {!showForm && !editingId ? (
            <Button type="button" onClick={() => setShowForm(true)}>
              Add procedure
            </Button>
          ) : null}
        </div>
      </CardHeader>

      {showForm && !editingId ? <div className="mb-4">{form}</div> : null}

      {error ? (
        <div className="mb-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          {error}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="px-1 py-2.5 text-base text-ink-faint">
          No procedures yet. Add the ones this hospital files claims for — a
          checklist is set per insurer and procedure, so nothing can be
          configured until one exists.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Claims</TableHead>
              <TableHead>Rules</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((procedure) =>
              procedure.id === editingId ? (
                <TableRow key={procedure.id}>
                  <TableCell colSpan={5} className="bg-accent-soft/40">
                    {form}
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow
                  key={procedure.id}
                  className={`${procedure.isActive ? "" : "[&>td]:opacity-60"}${
                    procedure.id === selectedId ? " bg-accent-soft" : ""
                  }`}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {onSelect ? (
                        <button
                          type="button"
                          onClick={() => onSelect(procedure.id)}
                          className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[length:inherit] text-accent-ink underline decoration-dotted underline-offset-2"
                        >
                          {procedure.name}
                        </button>
                      ) : (
                        procedure.name
                      )}
                      {!procedure.isActive ? (
                        <Badge variant="neutral">Retired</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-ink-faint">
                    {procedure.code ?? "—"}
                  </TableCell>
                  <TableCell>{procedure.claims ?? 0}</TableCell>
                  <TableCell>{procedure.rules ?? 0}</TableCell>
                  <TableCell className="flex justify-end gap-1 whitespace-nowrap">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => startEdit(procedure)}
                    >
                      Edit
                    </Button>
                    {/* The reversible one, and the one a desk actually
                        needs: deleting is refused the moment a claim
                        points at the row, which is every procedure the
                        hospital has really used. */}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        setActive.mutate({
                          id: procedure.id,
                          isActive: !procedure.isActive,
                        })
                      }
                    >
                      {procedure.isActive ? "Retire" : "Reinstate"}
                    </Button>
                    {/* Only when nothing depends on it. A procedure with
                        claims against it keeps its name, because those
                        claims were opened under it. */}
                    {!procedure.claims && !procedure.rules ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirmingDelete(procedure)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
