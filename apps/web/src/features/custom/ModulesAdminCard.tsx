import { useState } from "react";
import { Link } from "react-router-dom";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
export function ModulesAdminCard() {
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
        {!showForm ? (
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
                  {/* Only when it holds nothing — the API refuses otherwise. */}
                  {(module.recordCount ?? 0) === 0 ? (
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

              {expanded === module.id ? <FieldEditor module={module} /> : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** A module's fields: what its form asks for, and what its table shows. */
function FieldEditor({ module }: { module: CustomModule }) {
  const add = useAddField(module.slug);
  const removeField = useRemoveField(module.slug);

  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const needsOptions = takesOptions(fieldType);
  const optionList = options
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const canAdd =
    label.trim().length > 0 && (!needsOptions || optionList.length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdd) return;
    setError(null);
    try {
      await add.mutateAsync({
        label: label.trim(),
        fieldType,
        required,
        showInList: true,
        ...(needsOptions ? { options: optionList } : {}),
      });
      setLabel("");
      setOptions("");
      setRequired(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that field.");
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      {error ? (
        <div className="mb-2 rounded-md border border-critical bg-critical-bg px-3 py-2 text-sm font-medium text-critical">
          {error}
        </div>
      ) : null}

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

      {module.fields.length === 0 ? (
        <p className="m-0 mb-2 text-sm text-ink-faint">
          No fields yet — the form is empty until one exists.
        </p>
      ) : (
        <ul className="m-0 mb-3 flex list-none flex-col gap-1 p-0">
          {module.fields.map((field) => (
            <li
              key={field.id}
              className="flex items-center justify-between gap-3 rounded-sm bg-surface-sunken px-2.5 py-1.5 text-sm"
            >
              <span className="min-w-0">
                <b className="font-semibold">{field.label}</b>
                <span className="ml-2 text-ink-faint">
                  {CUSTOM_FIELD_TYPE_BY_KEY[field.fieldType]?.label ??
                    field.fieldType}
                  {field.required ? " · required" : ""}
                </span>
              </span>
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-sm text-ink-faint hover:text-critical"
                onClick={() => setConfirming(field.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
        <FormField
          label="Field name"
          htmlFor={`new-field-${module.id}`}
          className="mb-0 flex-[2_1_180px]"
        >
          <Input
            id={`new-field-${module.id}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Consultant"
          />
        </FormField>
        <FormField
          label="Type"
          htmlFor={`new-field-type-${module.id}`}
          className="mb-0 flex-[0_1_175px]"
        >
          <Select
            value={fieldType}
            onValueChange={(v) => setFieldType(v as CustomFieldType)}
          >
            <SelectTrigger
              id={`new-field-type-${module.id}`}
              aria-label="Field type"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUSTOM_FIELD_TYPES.map((t) => (
                <SelectItem key={t.type} value={t.type}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        {needsOptions ? (
          <FormField
            label="Options"
            htmlFor={`new-options-${module.id}`}
            hint="Comma separated"
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
        <div className="pb-[2px]">
          <Button type="submit" size="sm" disabled={!canAdd || add.isPending}>
            {add.isPending ? "Adding…" : "Add field"}
          </Button>
        </div>
      </form>
    </div>
  );
}
