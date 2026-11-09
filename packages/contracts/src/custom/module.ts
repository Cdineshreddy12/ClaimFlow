import { z } from "zod";

/**
 * Modules a hospital defines for itself.
 *
 * Adapted from the b2b-crm's custom-module system (see its
 * CUSTOM_FORMS_IMPLEMENTATION_GUIDE.md): a module row describing the
 * thing, a normalised field table describing its form, and records
 * holding the answers as JSON. Three tables instead of a migration per
 * idea.
 *
 * Deliberately narrower than the CRM's. No tenant column — one
 * hospital per install — and no relation field type, because a
 * lookup to another module needs a picker, referential integrity and a
 * delete policy, and none of that is "simple". A desk that needs to
 * point at a claim can hold its reference as text today.
 *
 * The field types start from the ones the pre-auth form builder has
 * (`PREAUTH_FIELD_TYPES`) and go further. The CRM's guide is explicit
 * that a second registry is the mistake to avoid, and the lesson
 * applies to itself: two registries drift, and then "Choice" means
 * something different depending on which screen you are on. So every
 * type the two share keeps the pre-auth registry's own key and label,
 * and a test holds them to it.
 *
 * They are not the same list, though, and forcing them to be would be
 * the worse mistake. A pre-auth form is the IRDAI's document — adding
 * "Link" to it means offering a hospital a field no insurer will read.
 * A module is the hospital's own, so it gets the types an internal
 * register actually needs. The split is by surface, not by registry.
 */

export const CustomFieldType = z.enum([
  // Shared with the pre-auth builder, same keys.
  "text",
  "longtext",
  "integer",
  "currency",
  "date",
  "time",
  "enum",
  // A module's own.
  "decimal",
  "datetime",
  "multienum",
  "checkbox",
  "email",
  "phone",
  "url",
]);
export type CustomFieldType = z.infer<typeof CustomFieldType>;

/*
  No "file". Uploading needs the S3 presign flow the claim documents
  use, and a picker that silently did nothing would be worse than not
  offering the type at all.
*/

/** Capability flags, so a screen asks the registry instead of hardcoding a type. */
export interface CustomFieldTypeDef {
  type: CustomFieldType;
  label: string;
  /** Needs an options list to mean anything. */
  hasOptions?: boolean;
  /** Renders as a multi-line control. */
  multiline?: boolean;
  /** Holds a JSON array of chosen values rather than one scalar. */
  isMulti?: boolean;
}

/** Everything a module's field picker offers, in the order it offers it. */
export const CUSTOM_FIELD_TYPES: CustomFieldTypeDef[] = [
  { type: "text", label: "Short text" },
  { type: "longtext", label: "Long text", multiline: true },
  { type: "integer", label: "Whole number" },
  { type: "decimal", label: "Decimal number" },
  { type: "currency", label: "Amount" },
  { type: "date", label: "Date" },
  { type: "time", label: "Time" },
  { type: "datetime", label: "Date & time" },
  { type: "enum", label: "Choice", hasOptions: true },
  {
    type: "multienum",
    label: "Multiple choice",
    hasOptions: true,
    isMulti: true,
  },
  { type: "checkbox", label: "Checkbox" },
  { type: "email", label: "Email" },
  { type: "phone", label: "Phone" },
  { type: "url", label: "Link" },
];

export const CUSTOM_FIELD_TYPE_BY_KEY: Record<
  CustomFieldType,
  CustomFieldTypeDef
> = Object.fromEntries(CUSTOM_FIELD_TYPES.map((t) => [t.type, t])) as Record<
  CustomFieldType,
  CustomFieldTypeDef
>;

/** Whether a field of this type is configured with a list of choices. */
export function takesOptions(fieldType: CustomFieldType): boolean {
  return CUSTOM_FIELD_TYPE_BY_KEY[fieldType]?.hasOptions === true;
}

/**
 * The chosen values of a multiple-choice answer.
 *
 * Held as a JSON array inside the same string column every other type
 * uses. The alternative — a separate column, or a delimiter — either
 * complicates every type to serve one, or breaks the first time an
 * option contains the delimiter.
 */
export function parseMultiValue(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

/** Empty reads as absent, so an untouched multi-choice field isn't stored as "[]". */
export function serialiseMultiValue(values: string[]): string {
  return values.length > 0 ? JSON.stringify(values) : "";
}

/**
 * The URL segment and the key a record's data is stored under.
 *
 * Lower-case, digits and single hyphens. Generated from the label
 * rather than typed, so a desk never has to think about it, but stored
 * explicitly: a module renamed later must not change the key its
 * existing records were written under.
 */
export const Slug = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "letters, digits and hyphens only");

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const CustomModuleInput = z.object({
  /** Singular, as it appears on a record: "Ward round". */
  name: z.string().trim().min(1).max(60),
  /** Plural, as it appears in the nav: "Ward rounds". */
  pluralName: z.string().trim().min(1).max(60),
  description: z.string().trim().max(240).optional(),
});
export type CustomModuleInput = z.infer<typeof CustomModuleInput>;

export const CustomFieldInput = z
  .object({
    label: z.string().trim().min(1).max(80),
    fieldType: CustomFieldType,
    required: z.boolean().default(false),
    /** Only meaningful on a field that takes choices; rejected elsewhere. */
    options: z.array(z.string().trim().min(1)).max(50).optional(),
    helpText: z.string().trim().max(160).optional(),
    /** Whether the records table shows a column for it. */
    showInList: z.boolean().default(true),
  })
  .refine((f) => !takesOptions(f.fieldType) || (f.options?.length ?? 0) > 0, {
    message: "A choice field needs at least one option",
    path: ["options"],
  })
  .refine((f) => takesOptions(f.fieldType) || !f.options?.length, {
    message: "Only a choice field takes options",
    path: ["options"],
  });
export type CustomFieldInput = z.infer<typeof CustomFieldInput>;

export interface CustomField {
  id: string;
  moduleId: string;
  /** Stable key the record's JSON is written under. Never changes. */
  fieldKey: string;
  label: string;
  fieldType: CustomFieldType;
  required: boolean;
  options: string[] | null;
  helpText: string | null;
  showInList: boolean;
  sortOrder: number;
}

export interface CustomModule {
  id: string;
  name: string;
  pluralName: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  fields: CustomField[];
  /** How many records exist, so a module can't be deleted blind. */
  recordCount?: number;
}

export interface CustomRecord {
  id: string;
  moduleId: string;
  data: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/** A record's answers, before validation. Shape only — meaning comes from the fields. */
export const CustomRecordInput = z.object({
  data: z.record(z.string(), z.string()),
});
export type CustomRecordInput = z.infer<typeof CustomRecordInput>;

export interface FieldError {
  fieldKey: string;
  message: string;
}

/** Only the two schemes a browser will actually open. */
function isHttpUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Checks a record's answers against the module's own fields.
 *
 * Lives here rather than in the API because both sides need it: the
 * form disables its save button on the same rules the server refuses
 * on, and a second implementation is how those two drift apart.
 *
 * Everything is stored as a string — one jsonb column, one canonical
 * representation per type, exactly as the pre-auth fields work. The
 * type is what the value has to *parse as*, not what it is held as.
 */
export function validateRecord(
  fields: CustomField[],
  data: Record<string, string>,
): FieldError[] {
  const errors: FieldError[] = [];

  for (const field of fields) {
    const raw = data[field.fieldKey]?.trim() ?? "";

    if (!raw) {
      // An absent optional field is absent, not invalid. Only a
      // required one has anything to say here.
      if (field.required) {
        errors.push({ fieldKey: field.fieldKey, message: "Required" });
      }
      continue;
    }

    switch (field.fieldType) {
      case "integer":
        if (!/^-?\d+$/.test(raw)) {
          errors.push({ fieldKey: field.fieldKey, message: "Whole number" });
        }
        break;
      case "currency":
        if (!/^-?\d+(\.\d{1,2})?$/.test(raw) || Number.isNaN(Number(raw))) {
          errors.push({
            fieldKey: field.fieldKey,
            message: "Amount in rupees",
          });
        }
        break;
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
          errors.push({ fieldKey: field.fieldKey, message: "A real date" });
        }
        break;
      case "time":
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
          errors.push({
            fieldKey: field.fieldKey,
            message: "A time, as HH:MM",
          });
        }
        break;
      case "decimal":
        if (!/^-?\d+(\.\d+)?$/.test(raw)) {
          errors.push({ fieldKey: field.fieldKey, message: "A number" });
        }
        break;
      case "datetime":
        if (
          !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(raw) ||
          Number.isNaN(Date.parse(raw))
        ) {
          errors.push({
            fieldKey: field.fieldKey,
            message: "A date and a time",
          });
        }
        break;
      case "enum":
        if (!field.options?.includes(raw)) {
          errors.push({
            fieldKey: field.fieldKey,
            message: "Pick one of the options",
          });
        }
        break;
      case "multienum": {
        const chosen = parseMultiValue(raw);
        if (chosen.length === 0) {
          errors.push({
            fieldKey: field.fieldKey,
            message: "Pick at least one option",
          });
        } else if (chosen.some((v) => !field.options?.includes(v))) {
          errors.push({
            fieldKey: field.fieldKey,
            message: "Pick from the options",
          });
        }
        break;
      }
      /*
        A tick box is stored ticked or not stored at all, so a required
        one means "must be ticked" — the consent box, not a question
        with two answers. A desk that needs a real yes *and* a real no
        wants a Choice field, where "No" is an answer rather than the
        absence of one.
      */
      case "checkbox":
        if (raw !== "true") {
          errors.push({
            fieldKey: field.fieldKey,
            message: "Tick or leave it",
          });
        }
        break;
      case "email":
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) {
          errors.push({
            fieldKey: field.fieldKey,
            message: "An email address",
          });
        }
        break;
      /*
        Deliberately permissive: landlines, mobiles, extensions and
        country codes are all real, and refusing a number a desk can
        actually dial is worse than storing an odd one.
      */
      case "phone":
        if (!/^\+?\d{7,15}$/.test(raw.replace(/[\s()-]/g, ""))) {
          errors.push({ fieldKey: field.fieldKey, message: "A phone number" });
        }
        break;
      case "url":
        if (!isHttpUrl(raw)) {
          errors.push({
            fieldKey: field.fieldKey,
            message: "A link starting http:// or https://",
          });
        }
        break;
      default:
        break;
    }
  }

  /*
    Answers to fields that no longer exist are dropped rather than
    rejected. A desk removing a field should not make every record
    written before it unsaveable — the column is gone, and so is the
    answer.
  */
  return errors;
}

/** Only the answers the module still has fields for. */
export function pruneToFields(
  fields: CustomField[],
  data: Record<string, string>,
): Record<string, string> {
  const keys = new Set(fields.map((f) => f.fieldKey));
  return Object.fromEntries(
    Object.entries(data).filter(
      ([key, value]) => keys.has(key) && value !== "",
    ),
  );
}
