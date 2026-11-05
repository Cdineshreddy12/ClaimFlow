import { useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { HospitalBrandingStep } from "@claimflow/contracts";
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
    },
  });

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
            <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              Couldn&apos;t upload that logo — try again.
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
                  placeholder="#1A73E8"
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
