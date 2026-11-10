import { useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import {
  DEFAULT_PREAUTH_DECLARATION,
  DEFAULT_PREAUTH_TEMPLATE,
  HospitalBrandingStep,
  PREAUTH_LOGO_PLACEMENT_LABEL,
  PREAUTH_TEMPLATE_BLURB,
  PREAUTH_TEMPLATE_LABEL,
  PREAUTH_TYPEFACE_LABEL,
  PreauthLogoPlacement,
  PreauthTemplate,
  PreauthTypeface,
  preauthOptions,
} from "@claimflow/contracts";
import { AppShell } from "@/app/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "../auth/AuthProvider";
import { useHospital, useUpdateProfile, useUploadLogo } from "./api";

type FormValues = z.input<typeof HospitalBrandingStep>;

const DEFAULT_ACCENT = "#1A1A1A";

/**
 * What the printed pre-auth form looks like, as opposed to what it says.
 *
 * Nothing here is required — there's no gate on it the way the onboarding
 * wizard gates claim filing. A desk that never visits this page still
 * prints a correct, plain-ink form; this only lets one that cares make it
 * look like theirs.
 */
export function BrandingSettingsPage() {
  const { role } = useAuth();
  const canEdit = role === "org_admin";

  const { data: hospital, isLoading } = useHospital();
  const uploadLogo = useUploadLogo();
  const updateProfile = useUpdateProfile();
  const fileInput = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues, unknown, z.output<typeof HospitalBrandingStep>>({
    resolver: zodResolver(HospitalBrandingStep),
    values: {
      brandAccentColor: hospital?.brandAccentColor ?? "",
      tagline: hospital?.tagline ?? "",
      documentFooterNote: hospital?.documentFooterNote ?? "",
      preauthTemplate:
        (hospital?.preauthTemplate as PreauthTemplate | undefined) ??
        DEFAULT_PREAUTH_TEMPLATE,
      // Parsed rather than read field by field, so a row written before
      // an option existed still fills the form with that option's
      // default instead of `undefined`.
      preauthOptions: preauthOptions(hospital?.preauthOptions),
    },
  });

  const chosenTemplate = watch("preauthTemplate");
  const chosenTypeface = watch("preauthOptions.typeface");
  const chosenLogoPlacement = watch("preauthOptions.logoPlacement");

  if (isLoading || !hospital) return <Loader label="Loading branding…" />;

  return (
    <AppShell
      title="Document branding"
      subtitle="What the printed pre-auth form looks like"
    >
      <div className="flex max-w-[640px] flex-col gap-5">
        {!canEdit ? (
          <div className="rounded-md border border-line bg-surface-sunken px-3.5 py-2.5 text-base text-ink-faint">
            Only an admin can change this. You can see what's set below.
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Letterhead logo</CardTitle>
          </CardHeader>

          <div className="flex items-center gap-4">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-sunken">
              {hospital.logoUrl ? (
                <img
                  src={hospital.logoUrl}
                  alt={`${hospital.name} logo`}
                  className="size-full object-contain"
                />
              ) : (
                <span className="text-2xs text-ink-faint">No logo</span>
              )}
            </div>

            {canEdit ? (
              <div className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadLogo.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploadLogo.isPending
                    ? "Uploading…"
                    : hospital.logoUrl
                      ? "Replace logo"
                      : "Upload logo"}
                </Button>
                <span className="text-2xs text-ink-faint">
                  PNG or JPEG. Prints at up to 130×46pt on the form.
                </span>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadLogo.mutate(file);
                    e.target.value = "";
                  }}
                />
              </div>
            ) : null}
          </div>

          {uploadLogo.isError ? (
            // The reason, not "try again". Every way this fails is
            // deterministic — the file is too big, or it is a type a
            // letterhead cannot carry — so inviting a retry invites the
            // same failure, and says nothing about what to change.
            <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              {uploadLogo.error instanceof Error && uploadLogo.error.message
                ? uploadLogo.error.message
                : "Couldn't upload that logo."}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Form details</CardTitle>
          </CardHeader>

          <form
            onSubmit={handleSubmit((values) =>
              updateProfile.mutate({ step: "branding", data: values }),
            )}
          >
            <FormField
              label="Accent color"
              htmlFor="brandAccentColor"
              optional
              hint="Colors the title on the printed form"
              error={errors.brandAccentColor?.message}
            >
              <div className="flex items-center gap-2.5">
                <input
                  type="color"
                  aria-label="Pick an accent color"
                  disabled={!canEdit}
                  className="size-9 shrink-0 cursor-pointer rounded-md border border-line-strong bg-surface-raised p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                  // The swatch is just a faster way to fill in the text
                  // field below, which is what react-hook-form actually
                  // tracks — so a hex value typed by hand isn't fought.
                  value={
                    /^#[0-9a-fA-F]{6}$/.test(watch("brandAccentColor") ?? "")
                      ? (watch("brandAccentColor") as string)
                      : DEFAULT_ACCENT
                  }
                  onChange={(e) =>
                    setValue("brandAccentColor", e.target.value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
                <Input
                  id="brandAccentColor"
                  // "e.g." because a bare hex here reads as a value
                  // that's already set, while the swatch beside it
                  // shows the near-black the title actually prints in
                  // when no accent is chosen — two different colours
                  // claiming to be the current one.
                  placeholder="e.g. #1A73E8"
                  disabled={!canEdit}
                  aria-invalid={Boolean(errors.brandAccentColor)}
                  {...register("brandAccentColor")}
                />
              </div>
            </FormField>

            <FormField
              label="Tagline"
              htmlFor="tagline"
              optional
              hint="Printed under the hospital name"
              error={errors.tagline?.message}
            >
              <Input
                id="tagline"
                disabled={!canEdit}
                placeholder="Multi-specialty, since 1998"
                aria-invalid={Boolean(errors.tagline)}
                {...register("tagline")}
              />
            </FormField>

            {/* Chosen before the colours, because it decides what the
                colours land on. A TPA desk sorts paper by shape before
                it reads a word, and hospitals disagree about which
                shape clears fastest. */}
            <FormField
              label="Form template"
              htmlFor="preauthTemplate"
              hint="Styling only — every template prints the same fields, in the same order"
              error={errors.preauthTemplate?.message}
            >
              <ChoiceRow
                options={PreauthTemplate.options}
                value={chosenTemplate}
                onPick={(next) =>
                  setValue("preauthTemplate", next, { shouldDirty: true })
                }
                label={(option) => PREAUTH_TEMPLATE_LABEL[option]}
                blurbs={PREAUTH_TEMPLATE_BLURB}
                disabled={!canEdit}
              />
            </FormField>

            <FormField
              label="Typeface"
              htmlFor="preauthTypeface"
              hint="Helvetica reads as modern; Times reads as official"
            >
              <ChoiceRow
                id="preauthTypeface"
                options={PreauthTypeface.options}
                value={chosenTypeface}
                onPick={(next) =>
                  setValue("preauthOptions.typeface", next, {
                    shouldDirty: true,
                  })
                }
                label={(option) => PREAUTH_TYPEFACE_LABEL[option]}
                disabled={!canEdit}
              />
            </FormField>

            <FormField
              label="Logo placement"
              htmlFor="preauthLogoPlacement"
              hint="A wide lockup suits going above the name; a square mark suits beside it"
            >
              <ChoiceRow
                id="preauthLogoPlacement"
                options={PreauthLogoPlacement.options}
                value={chosenLogoPlacement}
                onPick={(next) =>
                  setValue("preauthOptions.logoPlacement", next, {
                    shouldDirty: true,
                  })
                }
                label={(option) => PREAUTH_LOGO_PLACEMENT_LABEL[option]}
                disabled={!canEdit}
              />
            </FormField>

            <FormField
              label="Declaration"
              htmlFor="preauthDeclaration"
              optional
              hint="The sentence above the signatures. Blank prints the standard wording."
              error={errors.preauthOptions?.declaration?.message}
            >
              <Textarea
                id="preauthDeclaration"
                disabled={!canEdit}
                rows={2}
                placeholder={DEFAULT_PREAUTH_DECLARATION}
                {...register("preauthOptions.declaration")}
              />
            </FormField>

            {/* Switches, grouped: each is one line on the page and
                none of them needs its own heading. */}
            <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
              <legend className="mb-1 p-0 text-sm font-semibold text-ink">
                Also print
              </legend>
              {(
                [
                  [
                    "pageNumbers",
                    "Page numbers",
                    "“Page 1 of 2” — a long form arrives as loose sheets",
                  ],
                  [
                    "patientSignature",
                    "Patient signature line",
                    "A second line beside the doctor's",
                  ],
                  [
                    "accentHeadings",
                    "Accent on section names",
                    "Carries the colour past the title",
                  ],
                ] as const
              ).map(([key, title, hint]) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-start gap-2.5"
                >
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    className="mt-1 size-4 shrink-0 accent-accent"
                    {...register(`preauthOptions.${key}` as const)}
                  />
                  <span className="min-w-0">
                    <span className="block text-base text-ink">{title}</span>
                    <span className="block text-sm leading-snug text-ink-faint">
                      {hint}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <FormField
              label="Footer note"
              htmlFor="documentFooterNote"
              optional
              hint="Printed under the signature block — bank details, a closing line"
              error={errors.documentFooterNote?.message}
            >
              <Textarea
                id="documentFooterNote"
                disabled={!canEdit}
                rows={3}
                aria-invalid={Boolean(errors.documentFooterNote)}
                {...register("documentFooterNote")}
              />
            </FormField>

            {canEdit ? (
              <div className="mt-2 flex justify-end">
                <Button
                  type="submit"
                  disabled={!isDirty || updateProfile.isPending}
                >
                  {updateProfile.isPending ? "Saving…" : "Save branding"}
                </Button>
              </div>
            ) : null}

            {updateProfile.isError ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
                Couldn&apos;t save — try again.
              </div>
            ) : null}
          </form>
        </Card>
      </div>
    </AppShell>
  );
}

/**
 * A row of mutually exclusive choices.
 *
 * Three of these now — template, typeface, logo placement — and each
 * shows a name the reader recognises rather than the stored key. A
 * native <select> would hide two of the three options behind a click
 * on a page whose whole job is choosing between looks.
 */
function ChoiceRow<T extends string>({
  id,
  options,
  value,
  onPick,
  label,
  disabled,
  blurbs,
}: {
  id?: string;
  options: readonly T[];
  value: T | undefined;
  onPick: (next: T) => void;
  label: (option: T) => string;
  disabled: boolean;
  blurbs?: Record<string, string>;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      className={`grid gap-2 ${options.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
    >
      {options.map((option) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onPick(option)}
            className={`cursor-pointer rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "border-accent bg-accent-soft"
                : "border-line bg-surface-raised hover:border-line-strong"
            }`}
          >
            <span className="block text-base font-semibold text-ink">
              {label(option)}
            </span>
            {blurbs?.[option] ? (
              <span className="mt-0.5 block text-sm leading-snug text-ink-faint">
                {blurbs[option]}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
