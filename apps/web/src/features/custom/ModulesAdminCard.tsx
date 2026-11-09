import { useState } from "react";
import { Link } from "react-router-dom";
import { Add, Search, X } from "reicon-react";
import {
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_BY_KEY,
  slugify,
  takesOptions,
  type CustomFieldType,
  type CustomModule,
} from "@claimflow/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
  useAddField,
  useCreateModule,
  useCustomModules,
  useDeleteModule,
  useRemoveField,
  useSetModuleActive,
} from "./api";

/**
 * Where a hospital invents a module of its own.
 *
 * Adapted from the b2b-crm's custom modules. Two deliberate
 * narrowings: no relation field type, because a lookup needs a picker
 * and a delete policy that "simple" can't carry; and the field types
 * are the pre-auth builder's own registry rather than a second one,
 * which is the mistake the CRM's guide warns about in its own code.
 */
export function ModulesAdminCard({
  canEdit = true,
}: {
  /** Defining/hiding/deleting a module or its fields — the API allows
   *  org_admin and desk_head. Records within a module are a separate
   *  screen (/m/:slug) open to every role, unaffected by this. */
  canEdit?: boolean;
} = {}) {
  const { data: modules, isLoading, isError } = useCustomModules(true);
  const create = useCreateModule();
  const setActive = useSetModuleActive();
  const remove = useDeleteModule();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [pluralName, setPluralName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<CustomModule | null>(null);

  const busy = create.isPending || setActive.isPending || remove.isPending;

  if (isLoading) return <Loader label="Loading modules…" />;
  if (isError) {
    return (
      <div className="mb-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
        Couldn&apos;t load the modules.
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const singular = name.trim();
    if (!singular) return;
    setError(null);
    try {
      await create.mutateAsync({
        name: singular,
        // Defaulted rather than demanded: "Ward round" → "Ward rounds"
        // is right nine times in ten, and the tenth can be edited.
        pluralName: pluralName.trim() || `${singular}s`,
      });
      setName("");
      setPluralName("");
      // Left open, like the insurer and procedure forms — a hospital
      // setting this up defines several in one sitting.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create that.");
    }
  }

  const rows = modules ?? [];

  return (
    <Card>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Delete ${confirming?.name ?? ""}?`}
        description="It comes off the list for good, along with its fields. Only a module with no records can go — if you just want it out of the way, hide it."
        confirmLabel="Delete it"
        busy={remove.isPending}
        onConfirm={() =>
          confirming &&
          remove.mutate(confirming.id, {
            onSuccess: () => setConfirming(null),
            onError: (err) => {
              setError(err instanceof Error ? err.message : "Couldn't delete.");
              setConfirming(null);
            },
          })
        }
      />

      <CardHeader>
        <CardTitle>Modules</CardTitle>
        {canEdit && !showForm ? (
          <Button type="button" onClick={() => setShowForm(true)}>
            Add module
          </Button>
        ) : null}
      </CardHeader>

      <p className="m-0 mb-3 text-sm text-ink-faint">
        Lists this hospital keeps that the product has no table for — a ward
        round log, an implant register. Each one gets its own page and its own
        form.
      </p>

      {error ? (
        <div className="mb-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          {error}
        </div>
      ) : null}

      {showForm ? (
        <form
          className="mb-4 flex flex-col gap-2 rounded-md border border-line bg-surface-sunken p-3 sm:flex-row sm:items-end"
          onSubmit={submit}
        >
          <FormField
            label="Name"
            htmlFor="module-name"
            hint={name.trim() ? `Lives at /m/${slugify(name)}` : "One of them"}
            className="mb-0 flex-[2_1_200px]"
          >
            <Input
              id="module-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ward round"
            />
          </FormField>
          <FormField
            label="Plural"
            htmlFor="module-plural"
            optional
            hint="Shown in the sidebar"
            className="mb-0 flex-[2_1_200px]"
          >
            <Input
              id="module-plural"
              value={pluralName}
              onChange={(e) => setPluralName(e.target.value)}
              placeholder={name.trim() ? `${name.trim()}s` : "e.g. Ward rounds"}
            />
          </FormField>
          <div className="flex gap-2 pb-[2px]">
            <Button type="submit" disabled={!name.trim() || busy}>
              {create.isPending ? "Adding…" : "Add"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setError(null);
              }}
            >
              Done
            </Button>
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <p className="px-1 py-2.5 text-base text-ink-faint">
          No modules yet. Add one and give it fields — it appears in the sidebar
          straight away.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((module) => (
            <div
              key={module.id}
              className={`rounded-md border border-line px-3.5 py-3 ${
                module.isActive ? "" : "opacity-60"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/m/${module.slug}`}
                      className="font-semibold text-accent-ink underline decoration-dotted underline-offset-2"
                    >
                      {module.pluralName}
                    </Link>
                    {!module.isActive ? (
                      <Badge variant="neutral">Hidden</Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-sm text-ink-faint">
                    {module.fields.length} field
                    {module.fields.length === 1 ? "" : "s"} ·{" "}
                    {module.recordCount ?? 0} record
                    {module.recordCount === 1 ? "" : "s"} · /m/{module.slug}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setExpanded(expanded === module.id ? null : module.id)
                    }
                  >
                    {expanded === module.id ? "Done" : "Fields"}
                  </Button>
                  {canEdit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        setActive.mutate({
                          id: module.id,
                          isActive: !module.isActive,
                        })
                      }
                    >
                      {module.isActive ? "Hide" : "Show"}
                    </Button>
                  ) : null}
                  {/* Only when it holds nothing — the API refuses otherwise. */}
                  {canEdit && (module.recordCount ?? 0) === 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirming(module)}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>

              {expanded === module.id ? (
                <FieldEditor module={module} canEdit={canEdit} />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * A module's fields: what its form asks for, and what its table shows.
 *
 * Laid out as the pre-auth builder next door is, and for the same
 * reason — a palette of types on the left, the form it is building on
 * the right. Picking the type first is the way round that matches what
 * a desk is actually thinking ("I need a date on here"), and it puts
 * the whole catalogue in front of them instead of hiding fourteen
 * options inside a closed dropdown.
 *
 * It stops short of the builder's drag-to-reorder: a module's fields
 * have a sort order but no endpoint to change it, and a handle that
 * looks draggable and isn't is worse than no handle.
 */
function FieldEditor({
  module,
  canEdit,
}: {
  module: CustomModule;
  canEdit: boolean;
}) {
  const add = useAddField(module.slug);
  const removeField = useRemoveField(module.slug);

  // Set by the palette, and the only thing that opens the naming row —
  // so a field's type is decided before it is named, never changed
  // underneath a name already typed.
  const [drafting, setDrafting] = useState<CustomFieldType | null>(null);
  const [label, setLabel] = useState("");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const needsOptions = drafting !== null && takesOptions(drafting);
  const optionList = options
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const canAdd =
    label.trim().length > 0 && (!needsOptions || optionList.length > 0);

  const palette = CUSTOM_FIELD_TYPES.filter((t) =>
    t.label.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function startDraft(fieldType: CustomFieldType) {
    setError(null);
    setDrafting(fieldType);
    setLabel("");
    setOptions("");
    setRequired(false);
  }

  function cancelDraft() {
    setDrafting(null);
    setLabel("");
    setOptions("");
    setRequired(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdd || !drafting) return;
    setError(null);
    try {
      await add.mutateAsync({
        label: label.trim(),
        fieldType: drafting,
        required,
        showInList: true,
        ...(needsOptions ? { options: optionList } : {}),
      });
      // Type kept, name cleared: several fields of one kind in a row is
      // the common case when a desk is laying a form out.
      setLabel("");
      setOptions("");
      setRequired(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that field.");
    }
  }

  return (
    <div
      className={`mt-3 grid gap-3 border-t border-line pt-3${canEdit ? " lg:grid-cols-[210px_minmax(0,1fr)]" : ""}`}
    >
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Remove this field?"
        description="It comes off the form, and every answer already recorded against it is dropped. The records themselves are kept."
        confirmLabel="Remove it"
        busy={removeField.isPending}
        onConfirm={() =>
          confirming &&
          removeField.mutate(confirming, {
            onSuccess: () => setConfirming(null),
          })
        }
      />

      {canEdit ? (
        <aside className="self-start overflow-hidden rounded-lg border border-line bg-surface-raised">
          <div className="relative border-b border-line px-2.5 py-2 text-ink-faint [&_input]:h-8 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-line [&_input]:bg-surface [&_input]:py-0 [&_input]:pl-[30px] [&_input]:pr-2.5 [&_input]:font-[inherit] [&_input]:text-sm [&_input]:text-ink [&_input]:outline-none [&_input:focus-visible]:outline [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-offset-1 [&_input:focus-visible]:outline-accent [&_svg]:pointer-events-none [&_svg]:absolute [&_svg]:left-[19px] [&_svg]:top-1/2 [&_svg]:size-3 [&_svg]:-translate-y-1/2">
            <Search aria-hidden />
            <input
              type="text"
              placeholder="Search types…"
              aria-label="Search field types"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="px-3 pb-1.5 pt-3 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint [&_span]:font-medium">
            New fields <span>({palette.length})</span>
          </div>
          {/* One per row rather than the pre-auth builder's two columns:
            its eight types are all short, and these fourteen include
            "Multiple choice" and "Decimal number", which wrapped to two
            lines in a half-width cell and broke the list's rhythm. */}
          <div className="flex flex-col border-t border-line">
            {palette.map((type) => (
              <button
                key={type.type}
                type="button"
                className={`flex w-full cursor-pointer items-center gap-1.5 whitespace-nowrap border-0 border-b border-line bg-transparent px-2.5 py-[9px] text-left font-[inherit] text-sm last:border-b-0 enabled:hover:bg-accent-soft disabled:cursor-default disabled:opacity-45 ${
                  drafting === type.type
                    ? "bg-accent-soft font-semibold text-accent-ink"
                    : "text-ink"
                }`}
                disabled={add.isPending}
                title={`Add a ${type.label.toLowerCase()} field`}
                onClick={() => startDraft(type.type)}
              >
                <Add
                  size={11}
                  className="shrink-0 text-ink-faint"
                  aria-hidden
                />
                {type.label}
              </button>
            ))}
          </div>
          {palette.length === 0 ? (
            <p className="m-0 px-3 py-3 text-sm text-ink-faint">
              No type by that name.
            </p>
          ) : null}
        </aside>
      ) : null}

      <div className="min-w-0">
        {!canEdit ? (
          <p className="m-0 mb-2 text-sm text-ink-faint">
            You can view these fields but not change them — ask a desk head or
            an admin.
          </p>
        ) : null}
        {error ? (
          <div className="mb-2 rounded-md border border-critical bg-critical-bg px-3 py-2 text-sm font-medium text-critical">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-line">
          {module.fields.length === 0 ? (
            <p className="m-0 px-[13px] py-4 text-base text-ink-faint">
              No fields yet. Pick a type on the left — the form is empty until
              one exists.
            </p>
          ) : (
            module.fields.map((field) => (
              <div
                key={field.id}
                className="flex items-center gap-[9px] border-b border-line bg-surface-raised px-[13px] py-2.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-base">
                  {field.label}
                </span>
                {/* A label, not a control: there is no endpoint to make
                    a field required after the fact, so it must not look
                    like something that can be pressed. */}
                <span
                  className={`shrink-0 rounded-xs border px-[7px] py-0.5 text-2xs font-semibold uppercase tracking-[0.03em] ${
                    field.required
                      ? "border-critical bg-critical-bg text-critical"
                      : "border-line text-ink-faint"
                  }`}
                >
                  {field.required ? "Required" : "Optional"}
                </span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {CUSTOM_FIELD_TYPE_BY_KEY[field.fieldType]?.label ??
                    field.fieldType}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent text-sm leading-none text-ink-soft enabled:hover:border-line-strong enabled:hover:text-ink disabled:cursor-default disabled:opacity-30"
                    aria-label={`Take ${field.label} off the form`}
                    title="Take off the form"
                    onClick={() => setConfirming(field.id)}
                  >
                    <X size={13} aria-hidden />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>

        {canEdit && drafting ? (
          <form
            className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-accent bg-accent-soft p-3"
            onSubmit={submit}
          >
            <FormField
              label={`New ${(
                CUSTOM_FIELD_TYPE_BY_KEY[drafting]?.label ?? drafting
              ).toLowerCase()} field`}
              htmlFor={`new-field-${module.id}`}
              className="mb-0 flex-[2_1_180px]"
            >
              <Input
                id={`new-field-${module.id}`}
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Consultant"
              />
            </FormField>
            {needsOptions ? (
              <FormField
                label="Options"
                htmlFor={`new-options-${module.id}`}
                // No "comma separated" hint: the placeholder shows the
                // commas, and a hint under one of two side-by-side
                // fields lifts its input off the other's baseline.
                className="mb-0 flex-[2_1_200px]"
              >
                <Input
                  id={`new-options-${module.id}`}
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  placeholder="Morning, Evening, Night"
                />
              </FormField>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-ink-soft">
              <Checkbox
                checked={required}
                onCheckedChange={(ticked) => setRequired(ticked === true)}
              />
              Required
            </label>
            <div className="flex gap-1.5 pb-[2px]">
              <Button
                type="submit"
                size="sm"
                disabled={!canAdd || add.isPending}
              >
                {add.isPending ? "Adding…" : "Add field"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={cancelDraft}
              >
                Done
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
