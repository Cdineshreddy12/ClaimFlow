import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { FormField } from "./form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

interface SelectFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string;
}

/**
 * Radix Select is controlled-only, so it can't be wired with register()
 * the way an <input> can — Controller bridges it to react-hook-form.
 * Wrapped here once rather than at every call site.
 */
export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  placeholder = "Select…",
  error,
  hint,
  className,
}: SelectFieldProps<T>) {
  return (
    <FormField
      label={label}
      htmlFor={name}
      error={error}
      hint={hint}
      className={className}
    >
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select
            // "" is the untouched state; Radix wants undefined to show the placeholder.
            value={field.value || undefined}
            onValueChange={field.onChange}
          >
            <SelectTrigger
              id={name}
              aria-invalid={Boolean(error)}
              onBlur={field.onBlur}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </FormField>
  );
}
