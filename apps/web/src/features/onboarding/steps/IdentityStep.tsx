import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import {
  HOSPITAL_TYPE_LABEL,
  HospitalIdentityStep,
  OWNERSHIP_TYPE_LABEL,
  type HospitalIdentityStep as IdentityValues,
} from "@claimflow/contracts";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import type { Hospital } from "../../hospital/api";

/** Form state is wider than parsed state: an untouched select holds "", which zod rejects on submit with a real message. */
type FormValues = z.input<typeof HospitalIdentityStep>;

const toOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export function IdentityStep({
  hospital,
  onSubmit,
  isSaving,
}: {
  hospital: Hospital;
  onSubmit: (values: IdentityValues) => void;
  isSaving: boolean;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues, unknown, IdentityValues>({
    resolver: zodResolver(HospitalIdentityStep),
    defaultValues: {
      name: hospital.name ?? "",
      legalEntityName: hospital.legalEntityName ?? "",
      hospitalType: hospital.hospitalType ?? "",
      ownershipType: hospital.ownershipType ?? "",
      bedCount: hospital.bedCount ?? "",
    } as FormValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <h2 className="text-[17px] font-semibold -tracking-[0.01em]">
        Hospital identity
      </h2>
      <p className="mb-6 mt-1 text-[13px] text-ink-faint">
        How your hospital is known, and the entity behind it.
      </p>

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField
          label="Hospital name"
          htmlFor="name"
          error={errors.name?.message}
          className="sm:col-span-2"
        >
          <Input
            id="name"
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
        </FormField>

        <FormField
          label="Registered legal entity"
          htmlFor="legalEntityName"
          hint="The name on your PAN — often differs from the trading name"
          error={errors.legalEntityName?.message}
          className="sm:col-span-2"
        >
          <Input
            id="legalEntityName"
            aria-invalid={Boolean(errors.legalEntityName)}
            {...register("legalEntityName")}
          />
        </FormField>

        <SelectField
          control={control}
          name="hospitalType"
          label="Hospital type"
          options={toOptions(HOSPITAL_TYPE_LABEL)}
          error={errors.hospitalType?.message}
        />

        <SelectField
          control={control}
          name="ownershipType"
          label="Ownership"
          options={toOptions(OWNERSHIP_TYPE_LABEL)}
          error={errors.ownershipType?.message}
        />

        <FormField
          label="Total beds"
          htmlFor="bedCount"
          error={errors.bedCount?.message}
        >
          <Input
            id="bedCount"
            type="number"
            min={1}
            aria-invalid={Boolean(errors.bedCount)}
            {...register("bedCount")}
          />
        </FormField>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-5">
        <span />
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
