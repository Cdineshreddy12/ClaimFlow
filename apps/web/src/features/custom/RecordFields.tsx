import {
  CUSTOM_FIELD_TYPE_BY_KEY,
  parseMultiValue,
  serialiseMultiValue,
  type CustomField,
} from "@claimflow/contracts";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * One module's fields, drawn from its own definitions.
 *
 * Knows nothing about any particular module — it reads the field list
 * and picks a control per type. That is the whole point of the
 * feature: a desk invents a module on Tuesday and this renders its
 * form without a release.
 *
 * Every control is the shared primitive, never a bare element: a
 * hand-rolled `<textarea>` or a native tick box drifts from the rest
 * of the form the first time a token changes, and reads as a stray
 * OS widget in the middle of a styled page.
 *
 * Deliberately not a dialog. A record can carry twenty fields, and a
 * modal that scrolls inside itself on a laptop is the wrong container
 * for data entry — the form gets its own page and its own address, so
 * it can be linked to, reloaded, and backed out of.
 */
export function RecordFields({
  fields,
  data,
  onChange,
  errorFor,
}: {
  fields: CustomField[];
  data: Record<string, string>;
  onChange: (fieldKey: string, value: string) => void;
  errorFor: (field: CustomField) => string | undefined;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-5 md:grid-cols-2">
      {fields.map((field) => {
        const def = CUSTOM_FIELD_TYPE_BY_KEY[field.fieldType];
        const id = `field-${field.id}`;
        const value = data[field.fieldKey] ?? "";
        const invalid = errorFor(field) !== undefined;

        return (
          <div
            key={field.id}
            // The controls that need room get the full width; the
            // short ones pair up.
            className={
              def?.multiline || def?.isMulti ? "md:col-span-2" : undefined
            }
          >
            <FormField
              label={field.label}
              htmlFor={id}
              optional={!field.required}
              hint={field.helpText ?? undefined}
              error={errorFor(field)}
            >
              <FieldControl
                field={field}
                id={id}
                value={value}
                invalid={invalid}
                onChange={(next) => onChange(field.fieldKey, next)}
              />
            </FormField>
          </div>
        );
      })}
    </div>
  );
}

function FieldControl({
  field,
  id,
  value,
  invalid,
  onChange,
}: {
  field: CustomField;
  id: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const options = field.options ?? [];

  switch (field.fieldType) {
    case "longtext":
      return (
        <Textarea
          id={id}
          rows={4}
          aria-invalid={invalid}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "enum":
      return (
        <Select
          // Radix treats "" as "no value", and a controlled Select
          // given one complains rather than showing its placeholder.
          value={value || undefined}
          onValueChange={onChange}
        >
          <SelectTrigger id={id} aria-invalid={invalid}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "multienum": {
      const chosen = parseMultiValue(value);
      return (
        <div
          role="group"
          aria-label={field.label}
          className="flex flex-wrap gap-x-5 gap-y-2 py-1.5"
        >
          {options.map((option, index) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-2 text-base text-ink"
            >
              <Checkbox
                // On the first option only, so the field's own label
                // focuses the group rather than pointing at nothing.
                {...(index === 0 ? { id } : {})}
                checked={chosen.includes(option)}
                onCheckedChange={(ticked) =>
                  onChange(
                    serialiseMultiValue(
                      ticked === true
                        ? // Kept in the module's own option order, so
                          // the stored answer doesn't depend on the
                          // order a desk happened to tick them in.
                          options.filter(
                            (o) => o === option || chosen.includes(o),
                          )
                        : chosen.filter((o) => o !== option),
                    ),
                  )
                }
              />
              {option}
            </label>
          ))}
        </div>
      );
    }

    /*
      Just the box — the field's own label already sits above it and
      points at it, so repeating the text beside it would read the
      label out twice and put the tick box out of line with every
      other control in the grid.
    */
    case "checkbox":
      return (
        <div className="py-1.5">
          <Checkbox
            id={id}
            aria-invalid={invalid}
            checked={value === "true"}
            // Absent rather than "false": a tick box that isn't ticked
            // hasn't been answered, which is what lets a required one
            // mean "must be ticked".
            onCheckedChange={(ticked) =>
              onChange(ticked === true ? "true" : "")
            }
          />
        </div>
      );

    default:
      return (
        <Input
          id={id}
          type={inputTypeFor(field.fieldType)}
          inputMode={inputModeFor(field.fieldType)}
          step={field.fieldType === "decimal" ? "any" : undefined}
          aria-invalid={invalid}
          placeholder={placeholderFor(field.fieldType)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function inputTypeFor(fieldType: CustomField["fieldType"]): string {
  switch (fieldType) {
    case "date":
      return "date";
    case "time":
      return "time";
    case "datetime":
      return "datetime-local";
    case "integer":
    case "decimal":
    case "currency":
      return "number";
    /*
      Safe only because the form sets `noValidate`. Left to itself the
      browser enforces its own idea of these types and refuses to fire
      submit, which hides the message the contract actually produces —
      so the type here buys the right keyboard and autofill, nothing
      more. `url` and `phone` stay plain text: there is no native rule
      worth having for either, and "example.com" is a link a desk
      should be told about in our words, not the browser's.
    */
    case "email":
      return "email";
    case "url":
    case "phone":
    default:
      return "text";
  }
}

function inputModeFor(
  fieldType: CustomField["fieldType"],
): "numeric" | "decimal" | "tel" | "email" | "url" | undefined {
  switch (fieldType) {
    case "integer":
      return "numeric";
    case "decimal":
    case "currency":
      return "decimal";
    case "phone":
      return "tel";
    case "email":
      return "email";
    case "url":
      return "url";
    default:
      return undefined;
  }
}

/** Only where the expected shape isn't obvious from the control itself. */
function placeholderFor(
  fieldType: CustomField["fieldType"],
): string | undefined {
  switch (fieldType) {
    case "phone":
      return "+91 98765 43210";
    case "url":
      return "https://…";
    case "currency":
      return "0.00";
    default:
      return undefined;
  }
}
