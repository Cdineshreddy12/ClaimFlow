import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import {
  HospitalComplianceStep,
  NABH_STATUS_LABEL,
  type HospitalComplianceStep as ComplianceValues,
} from "@claimflow/contracts";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import type { Hospital } from "../../hospital/api";

/** Form state is wider than parsed state — see IdentityStep. */
type FormValues = z.input<typeof HospitalComplianceStep>;

export function ComplianceStep({
  hospital,
  onSubmit,
  onBack,
  isSaving,
}: {
  hospital: Hospital;
  onSubmit: (values: ComplianceValues) => void;
  onBack: () => void;
  isSaving: boolean;
}) {
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues, unknown, ComplianceValues>({
    resolver: zodResolver(HospitalComplianceStep),
    defaultValues: {
      rohiniId: hospital.rohiniId ?? "",
      registrationNumber: hospital.registrationNumber ?? "",
      registrationValidUntil: hospital.registrationValidUntil ?? "",
      pan: hospital.pan ?? "",
      gstin: hospital.gstin ?? "",
      nabhStatus: hospital.nabhStatus ?? "none",
      nabhValidUntil: hospital.nabhValidUntil ?? "",
    } as FormValues,
  });

  const nabhStatus = watch("nabhStatus");

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <h2 className="text-[17px] font-semibold -tracking-[0.01em]">
        Registration &amp; compliance
      </h2>
      <p className="mb-6 mt-1 text-[13px] text-ink-faint">
        These go on every pre-authorisation you send a TPA.
      </p>

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField
          label="ROHINI ID"
          htmlFor="rohiniId"
          hint="13 digits, from the IIB registry — IRDAI requires it for cashless settlement"
          error={errors.rohiniId?.message}
          className="sm:col-span-2"
        >
          <Input
            id="rohiniId"
            inputMode="numeric"
            maxLength={13}
            placeholder="1234567890123"
            aria-invalid={Boolean(errors.rohiniId)}
            {...register("rohiniId")}
          />
        </FormField>

        <FormField
          label="Registration number"
          htmlFor="registrationNumber"
          hint="Clinical Establishment Act or municipal"
          error={errors.registrationNumber?.message}
        >
          <Input
            id="registrationNumber"
            aria-invalid={Boolean(errors.registrationNumber)}
            {...register("registrationNumber")}
          />
        </FormField>

        <FormField
          label="Registration valid until"
          htmlFor="registrationValidUntil"
          error={errors.registrationValidUntil?.message}
        >
          <Input
            id="registrationValidUntil"
            type="date"
            aria-invalid={Boolean(errors.registrationValidUntil)}
            {...register("registrationValidUntil")}
          />
        </FormField>

        <FormField
          label="PAN"
          htmlFor="pan"
          hint="ABCDE1234F"
          error={errors.pan?.message}
        >
          <Input
            id="pan"
            maxLength={10}
            className="uppercase placeholder:normal-case"
            aria-invalid={Boolean(errors.pan)}
            {...register("pan")}
          />
        </FormField>

        <FormField
          label="GSTIN"
          htmlFor="gstin"
          optional
          hint="Leave blank if below the GST threshold"
          error={errors.gstin?.message}
        >
          <Input
            id="gstin"
            maxLength={15}
            className="uppercase placeholder:normal-case"
            aria-invalid={Boolean(errors.gstin)}
            {...register("gstin")}
          />
        </FormField>

        <SelectField
          control={control}
          name="nabhStatus"
          label="NABH accreditation"
          options={Object.entries(NABH_STATUS_LABEL).map(([value, label]) => ({
            value,
            label,
          }))}
          error={errors.nabhStatus?.message}
        />

        {nabhStatus && nabhStatus !== "none" ? (
          <FormField
            label="NABH valid until"
            htmlFor="nabhValidUntil"
            error={errors.nabhValidUntil?.message}
          >
            <Input
              id="nabhValidUntil"
              type="date"
              aria-invalid={Boolean(errors.nabhValidUntil)}
              {...register("nabhValidUntil")}
            />
          </FormField>
        ) : null}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-5">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
