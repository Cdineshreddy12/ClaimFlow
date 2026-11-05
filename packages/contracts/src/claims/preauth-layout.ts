import { z } from "zod";
import {
  PREAUTH_FIELDS,
  PREAUTH_GROUP_LABEL,
  PreauthFieldGroup,
} from "./preauth.js";

/**
 * Field types a configurable form may use.
 *
 * A superset of the fixed IRDAI catalogue's types: that list describes
 * the 24 standard fields, which never include an upload, but a
 * hospital's own field may.
 */
export const LayoutFieldType = z.enum([
  "text",
  "longtext",
  "integer",
  "currency",
  "date",
  "time",
  "enum",
  "file",
]);
export type LayoutFieldType = z.infer<typeof LayoutFieldType>;

/**
 * A configurable pre-authorisation form.
 *
 * Adapted from the dynamic-form system in the b2b-crm codebase (see its
 * CUSTOM_FORMS_IMPLEMENTATION_GUIDE.md) — specifically the
 * layout → section → placement → definition split, which is what makes
 * a form editable without the renderer knowing anything about the
 * fields. Its field components weren't portable (React 19, Tailwind 4,
 * lucide, and CRM concepts like lookups and merge fields), but the
 * model and its validation lessons are.
 *
 * One thing deliberately added that the CRM has no need for: a layout
 * is **snapshotted onto the claim** when the claim is opened, exactly
 * as the document checklist is (docs/adr/0001). Editing the form must
 * never change what an in-flight claim asked for — a TPA query six
 * weeks later has to be answerable against the form as it was sent.
 */

/** Capability flags, so the editor can ask the registry instead of hardcoding. */
export interface PreauthFieldTypeDef {
  type: LayoutFieldType;
  label: string;
  /** Needs an options list to mean anything. */
  hasOptions?: boolean;
  /** Accepts min/max bounds. */
  hasRange?: boolean;
  /** Renders as a multi-line control. */
  multiline?: boolean;
  /** Stores a FileValue rather than a plain string. */
  isFile?: boolean;
}

export const PREAUTH_FIELD_TYPES: PreauthFieldTypeDef[] = [
  { type: "text", label: "Short text" },
  { type: "longtext", label: "Long text", multiline: true },
  { type: "integer", label: "Whole number", hasRange: true },
  { type: "currency", label: "Amount", hasRange: true },
  { type: "date", label: "Date" },
  { type: "time", label: "Time" },
  { type: "enum", label: "Choice", hasOptions: true },
  { type: "file", label: "File upload", isFile: true },
];

/**
 * What a file field stores.
 *
 * Same shape the b2b-crm uses for its file/image fields — the S3 key
 * plus enough metadata to render and download it without a second
 * round trip. Held as JSON in the value column, because every other
 * field type stores a canonical string and one column is simpler than
 * a parallel table for a field type most forms won't use.
 */
export const FileValue = z.object({
  s3Key: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
export type FileValue = z.infer<typeof FileValue>;

/** Null when the text isn't a file value — a field retyped after the fact. */
export function parseFileValue(value: string | null): FileValue | null {
  if (!value) return null;
  try {
    const parsed = FileValue.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const PREAUTH_FIELD_TYPE_BY_KEY: Record<string, PreauthFieldTypeDef> =
  Object.fromEntries(PREAUTH_FIELD_TYPES.map((t) => [t.type, t]));

export const FieldOption = z.object({
  value: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
});
export type FieldOption = z.infer<typeof FieldOption>;

export const PreauthFieldDefinition = z.object({
  id: z.string(),
  /** Stable key the stored value is filed under. Never changes once used. */
  fieldKey: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  fieldType: LayoutFieldType,
  hint: z.string().max(200).nullable(),
  options: z.array(FieldOption).nullable(),
  /**
   * True for the 24 IRDAI fields. They can be reordered, re-labelled or
   * dropped from a layout, but not deleted or retyped — a TPA expects
   * "ICD-10 code" to mean an ICD-10 code.
   */
  isStandard: z.boolean(),
  conditionalOn: z
    .object({ fieldKey: z.string(), equals: z.string() })
    .nullable(),
});
export type PreauthFieldDefinition = z.infer<typeof PreauthFieldDefinition>;

export const PreauthPlacement = z.object({
  id: z.string(),
  displayOrder: z.number().int().min(0),
  /** 0 or 1. Ignored when the section is single-column. */
  columnPosition: z.number().int().min(0).max(1).default(0),
  /** Overrides the definition's own label for this layout only. */
  labelOverride: z.string().max(160).nullable(),
  required: z.boolean(),
  definition: PreauthFieldDefinition,
});
export type PreauthPlacement = z.infer<typeof PreauthPlacement>;

export const PreauthSection = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  displayOrder: z.number().int().min(0),
  columnCount: z.number().int().min(1).max(2).default(1),
  placements: z.array(PreauthPlacement),
});
export type PreauthSection = z.infer<typeof PreauthSection>;

export const PreauthLayout = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  /** Null is the fallback layout, used by any insurer without one. */
  insurerId: z.string().uuid().nullable(),
  sections: z.array(PreauthSection),
});
export type PreauthLayout = z.infer<typeof PreauthLayout>;

/** Label actually shown — the placement may override the definition's. */
export function placementLabel(placement: PreauthPlacement): string {
  return placement.labelOverride ?? placement.definition.label;
}

/** The placements in one column, in order. */
export function columnPlacements(
  section: PreauthSection,
  column: 0 | 1,
): PreauthPlacement[] {
  return section.placements
    .filter((p) =>
      section.columnCount === 1 ? true : (p.columnPosition ?? 0) === column,
    )
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Every placement in display order, flattened across sections. */
export function layoutPlacements(layout: PreauthLayout): PreauthPlacement[] {
  return [...layout.sections]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .flatMap((section) =>
      [...section.placements].sort(
        // Row-major, and `columnPosition` is the half that was missing.
        // `displayOrder` restarts in each column, so sorting on it
        // alone leaves every field tied with its neighbour across the
        // columns and the real order decided by however the sort broke
        // the tie. The form and the printed PDF both read this list, so
        // that was the order a desk sent to an insurer.
        (a, b) =>
          a.displayOrder - b.displayOrder ||
          a.columnPosition - b.columnPosition,
      ),
    );
}

/**
 * The IRDAI form as a layout — what a hospital starts from.
 *
 * Derived from PREAUTH_FIELDS rather than duplicated, so the standard
 * form has exactly one definition and the seeded layout can't drift
 * from the catalogue the PDF and the extractor read.
 */
export function defaultLayout(): PreauthLayout {
  const sections = PreauthFieldGroup.options.map((group, sectionIndex) => {
    const fields = PREAUTH_FIELDS.filter((f) => f.group === group);
    return {
      id: `section:${group}`,
      name: PREAUTH_GROUP_LABEL[group],
      displayOrder: sectionIndex,
      columnCount: 2,
      placements: fields.map((field, i) => ({
        id: `placement:${field.key}`,
        displayOrder: i,
        // Short fields pair up; prose takes the full width.
        columnPosition: field.type === "longtext" ? 0 : i % 2,
        labelOverride: null,
        // Nothing on the IRDAI form is required by us: a desk routinely
        // sends a partial pre-auth and fills the rest on query. The
        // gap view is how incompleteness gets surfaced, not a blocked
        // save.
        required: false,
        definition: {
          id: `definition:${field.key}`,
          fieldKey: field.key,
          label: field.label,
          fieldType: field.type as PreauthFieldDefinition["fieldType"],
          hint: field.hint ?? null,
          options: field.options ? [...field.options] : null,
          isStandard: true,
          conditionalOn: field.conditionalOn
            ? {
                fieldKey: field.conditionalOn.key,
                equals: field.conditionalOn.equals,
              }
            : null,
        },
      })),
    };
  });

  return {
    id: "layout:default",
    name: "IRDAI standard form",
    insurerId: null,
    sections,
  };
}

/**
 * A zod schema for one layout's values.
 *
 * Three behaviours here are lifted from the CRM's `buildZodSchema`,
 * each of which it learned the hard way and documented:
 *
 * 1. Numeric values arrive from inputs as strings. `z.coerce.number()`
 *    is the wrong tool — `Number("")` is 0, so clearing a field would
 *    silently save a zero. Coerce only strings that actually parse.
 * 2. An optional field that the user typed into and then cleared holds
 *    `""`, and `.optional()` only skips `undefined` — so format
 *    validators keep failing on the empty string forever. Normalise
 *    `""` to null before validating.
 * 3. An enum whose options have been emptied must reject everything
 *    rather than accept anything, so the broken state is visible.
 */
export function buildPreauthSchema(layout: PreauthLayout) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const placement of layoutPlacements(layout)) {
    const def = placement.definition;
    let base: z.ZodTypeAny;

    switch (def.fieldType) {
      case "integer":
        base = numericString(
          z.number({ invalid_type_error: "Enter a whole number" }).int(),
        );
        break;
      case "currency":
        base = numericString(
          z
            .number({ invalid_type_error: "Enter an amount" })
            .min(0, "Can't be negative"),
        );
        break;
      case "date":
        base = z.string().date("Enter a valid date");
        break;
      case "time":
        base = z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, e.g. 09:40");
        break;
      case "enum": {
        const values = (def.options ?? []).map((o) => o.value);
        base =
          values.length > 0
            ? z.enum(values as [string, ...string[]])
            : z.never();
        break;
      }
      case "longtext":
        base = z.string().max(1000, "Max 1000 characters");
        break;
      case "file":
        // The stored text is JSON. Validated on its parsed shape so a
        // half-written upload can't be saved as a file that isn't one.
        base = z
          .string()
          .refine((v) => parseFileValue(v) !== null, "Upload a file");
        break;
      default:
        base = z.string().max(200, "Max 200 characters");
    }

    shape[def.fieldKey] = placement.required
      ? requiredField(base, def.fieldType)
      : z.preprocess((v) => (v === "" ? null : v), base.optional().nullable());
  }

  return z.object(shape);
}

/**
 * Coerces a numeric-looking string, and only that.
 *
 * Deliberately not `z.coerce.number()`: `Number("")` is 0, so a cleared
 * field would save as zero rather than as empty. Anything unparseable
 * passes through untouched so the underlying validator reports the real
 * error.
 */
function numericString(schema: z.ZodTypeAny): z.ZodTypeAny {
  return z.preprocess((value) => {
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      if (!Number.isNaN(n)) return n;
    }
    return value;
  }, schema);
}

/**
 * A required field whose value may be null in the database — it was
 * added to the layout after the claim was opened. Null becomes a
 * type-appropriate blank so the form shows "required" rather than
 * "Expected string, received null".
 */
function requiredField(base: z.ZodTypeAny, type: string): z.ZodTypeAny {
  if (type === "integer" || type === "currency") return base;
  if (type === "enum") {
    return z.preprocess((v) => (v === null ? undefined : v), base);
  }
  return z.preprocess(
    (v) => (v === null ? "" : v),
    base.refine((v) => String(v).trim().length > 0, "Required"),
  );
}
