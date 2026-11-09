import { useState } from "react";
import { INSURER_TYPE_LABEL, type InsurerType } from "@claimflow/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Loader } from "@/components/ui/loader";
import {
  useCreateInsurer,
  useDeleteInsurer,
  useInsurers,
  useSetInsurerActive,
  useUpdateInsurer,
  type Insurer,
} from "./api";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The TPA master.
 *
 * Retiring is the primary action, not deleting. An insurer with claims
 * against it can never be removed without those claims losing the name
 * they were filed under, so the list shows how much depends on each one
 * and the API refuses a delete that would strand anything. Deleting is
 * only there for one typed in by mistake.
 */
export function InsurersAdminCard({
  selectedId,
  onSelect,
}: {
  /** Highlighted as the one the rules editor above is working on. */
  selectedId?: string | undefined;
  /** Clicking a name picks it upstairs — the list and the editor are one job. */
  onSelect?: ((insurerId: string) => void) | undefined;
} = {}) {
  const [showRetired, setShowRetired] = useState(false);
  /**
   * Collapsed until asked for.
   *
   * Four empty fields sat permanently above the list, which is read
   * constantly and added to rarely — the form took more height than the
   * insurers it was for.
   */
  const [showForm, setShowForm] = useState(false);
  const { data: insurers, isLoading, isError } = useInsurers(true);
  const create = useCreateInsurer();
  const update = useUpdateInsurer();
  const setActive = useSetInsurerActive();
  const remove = useDeleteInsurer();
  /*
    Deleting removes the row for good.

    Only offered on an insurer with no claims and no rules, so nothing
    depends on it — but it still sits next to Edit and Retire on a
    shared master list, and there is no undo. Retire is the reversible
    one; this is not.
  */
  const [confirmingDelete, setConfirmingDelete] = useState<Insurer | null>(
    null,
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<InsurerType>("tpa");
  const [code, setCode] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const busy =
    create.isPending ||
    update.isPending ||
    setActive.isPending ||
    remove.isPending;

  function reset() {
    setEditingId(null);
    setName("");
    setType("tpa");
    setCode("");
    setContactEmail("");
    setError(null);
  }

  function startEdit(insurer: Insurer) {
    setEditingId(insurer.id);
    setName(insurer.name);
    setType(insurer.type);
    setCode(insurer.code ?? "");
    setContactEmail(insurer.contactEmail ?? "");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    const body = { name: name.trim(), type, code, contactEmail };
    try {
      if (editingId) {
        await update.mutateAsync({ id: editingId, ...body });
      } else {
        await create.mutateAsync(body);
      }
      reset();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't save that insurer.",
      );
    }
  }

  async function onDelete(insurer: Insurer) {
    setError(null);
    setConfirmingDelete(null);
    try {
      await remove.mutateAsync(insurer.id);
    } catch (err) {
      // The API knows how much depends on it; surface that rather than
      // a generic failure, because the answer is "retire it instead".
      setError(
        err instanceof Error ? err.message : "Couldn't delete that insurer.",
      );
    }
  }

  const deleteConfirm = (
    <ConfirmDialog
      open={confirmingDelete !== null}
      onOpenChange={(open) => !open && setConfirmingDelete(null)}
      title={`Delete ${confirmingDelete?.name ?? ""}?`}
      description="It comes off the master list for good. Nothing is filed against it, so nothing breaks — but if you only want it off the picker, Retire keeps the record."
      confirmLabel="Delete it"
      busy={remove.isPending}
      onConfirm={() => confirmingDelete && onDelete(confirmingDelete)}
    />
  );

  if (isLoading) return <Loader label="Loading insurers…" />;
  if (isError) {
    return (
      <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
        Couldn&apos;t load the insurers.
      </div>
    );
  }

  /*
    One form, two homes.

    It only ever rendered above the table. Adding is fine there — it
    is where the "Add insurer" button is — but editing the thirtieth
    insurer scrolled the form off the top of the screen while the row
    you clicked stayed where it was, so the click looked like it had
    done nothing. Editing now happens in the row's own place.
  */
  const editForm = (
    <form
      className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center [&>*:first-child]:sm:flex-[2_1_200px] [&>*:nth-child(2)]:sm:flex-[0_1_175px] [&>*:nth-child(3)]:sm:flex-[0_1_130px] [&>*:nth-child(4)]:sm:flex-[1_1_180px]"
      onSubmit={submit}
    >
      <Input
        aria-label="Name"
        placeholder="e.g. Star Health TPA"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Select value={type} onValueChange={(v) => setType(v as InsurerType)}>
        <SelectTrigger aria-label="Type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tpa">TPA</SelectItem>
          <SelectItem value="insurer">Insurer</SelectItem>
          {/* PM-JAY and the state schemes. A payer on this list
                rather than a table of its own, so scheme checklist
                rules and scheme form layouts come from the machinery
                that already exists. */}
          <SelectItem value="scheme">Government scheme</SelectItem>
        </SelectContent>
      </Select>
      <Input
        aria-label="Short code"
        placeholder="Code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Input
        aria-label="Claims email"
        type="email"
        placeholder="Claims email"
        value={contactEmail}
        onChange={(e) => setContactEmail(e.target.value)}
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

  const rows = (insurers ?? []).filter((i) => showRetired || i.isActive);
  const retiredCount = (insurers ?? []).filter((i) => !i.isActive).length;

  return (
    <Card>
      {deleteConfirm}
      <CardHeader>
        <CardTitle>Insurers &amp; TPAs</CardTitle>
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
            <Button type="button" size="sm" onClick={() => setShowForm(true)}>
              Add insurer
            </Button>
          ) : null}
        </div>
      </CardHeader>

      {showForm && !editingId ? <div className="mb-4">{editForm}</div> : null}

      {error ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical mt-3">
          {error}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="px-1 py-2.5 text-base text-ink-faint">
          No insurers yet. Add the TPAs this desk files with — claims and
          checklist rules both key off them.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Claims</TableHead>
              <TableHead>Rules</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((insurer) =>
              // The row becomes the form while it is being edited, so
              // the fields appear where the click happened rather than
              // at the top of a table you may have scrolled past.
              insurer.id === editingId ? (
                <TableRow key={insurer.id}>
                  <TableCell colSpan={5} className="bg-accent-soft/40">
                    {editForm}
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow
                  key={insurer.id}
                  className={`${insurer.isActive ? "" : "[&>td]:opacity-60"}${
                    insurer.id === selectedId ? " bg-accent-soft" : ""
                  }`}
                >
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {onSelect ? (
                        <button
                          type="button"
                          onClick={() => onSelect(insurer.id)}
                          title="Show this one's document rules"
                          className="cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-[length:inherit] font-medium text-accent-ink underline decoration-dotted underline-offset-2"
                        >
                          {insurer.name}
                        </button>
                      ) : (
                        insurer.name
                      )}
                      {!insurer.isActive ? (
                        <Badge variant="neutral">Retired</Badge>
                      ) : null}
                    </div>
                    {insurer.contactEmail ? (
                      <span className="proc">{insurer.contactEmail}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>{INSURER_TYPE_LABEL[insurer.type]}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {insurer.claimCount}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {insurer.ruleCount}
                  </TableCell>
                  <TableCell className="flex justify-end gap-1 whitespace-nowrap">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => startEdit(insurer)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        setActive.mutate({
                          id: insurer.id,
                          isActive: !insurer.isActive,
                        })
                      }
                    >
                      {insurer.isActive ? "Retire" : "Reinstate"}
                    </Button>
                    {/* Only offered when nothing depends on it. The API
                        refuses otherwise; not showing the button spares
                        the desk finding out the hard way. */}
                    {insurer.claimCount === 0 && insurer.ruleCount === 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirmingDelete(insurer)}
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
