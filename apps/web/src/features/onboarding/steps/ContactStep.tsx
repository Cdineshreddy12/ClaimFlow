import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import {
  HospitalContactStep,
  INDIAN_STATES,
  type HospitalContactStep as ContactValues,
} from "@claimflow/contracts";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import type { Hospital } from "../../hospital/api";

/** Form state is wider than parsed state — see IdentityStep. Phone fields also transform (+91 stripped) so input ≠ output. */
type FormValues = z.input<typeof HospitalContactStep>;

const STATE_OPTIONS = INDIAN_STATES.map((state) => ({
  value: state,
  label: state,
}));

export function ContactStep({
  hospital,
  onSubmit,
  onBack,
  isSaving,
}: {
  hospital: Hospital;
  onSubmit: (values: ContactValues) => void;
  onBack: () => void;
  isSaving: boolean;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues, unknown, ContactValues>({
    resolver: zodResolver(HospitalContactStep),
    defaultValues: {
      addressLine1: hospital.addressLine1 ?? "",
      addressLine2: hospital.addressLine2 ?? "",
      city: hospital.city ?? "",
      state: hospital.state ?? "",
      pincode: hospital.pincode ?? "",
      phone: hospital.phone ?? "",
      email: hospital.email ?? "",
      website: hospital.website ?? "",
      deskContactName: hospital.deskContactName ?? "",
      deskContactPhone: hospital.deskContactPhone ?? "",
      deskContactEmail: hospital.deskContactEmail ?? "",
    } as FormValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <h2 className="text-[17px] font-semibold -tracking-[0.01em]">
        Address &amp; claims desk
      </h2>
      <p className="mb-6 mt-1 text-[13px] text-ink-faint">
        Where you are, and who a TPA should reach about a claim.
      </p>

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField
          label="Address"
          htmlFor="addressLine1"
          error={errors.addressLine1?.message}
          className="sm:col-span-2"
        >
          <Input
            id="addressLine1"
            aria-invalid={Boolean(errors.addressLine1)}
            {...register("addressLine1")}
          />
        </FormField>

        <FormField
          label="Address line 2"
          htmlFor="addressLine2"
          optional
          error={errors.addressLine2?.message}
          className="sm:col-span-2"
        >
          <Input id="addressLine2" {...register("addressLine2")} />
        </FormField>

        <FormField label="City" htmlFor="city" error={errors.city?.message}>
          <Input
            id="city"
            aria-invalid={Boolean(errors.city)}
            {...register("city")}
          />
        </FormField>

        <SelectField
          control={control}
          name="state"
          label="State"
          options={STATE_OPTIONS}
          error={errors.state?.message}
        />

        <FormField
          label="PIN code"
          htmlFor="pincode"
          error={errors.pincode?.message}
        >
          <Input
            id="pincode"
            inputMode="numeric"
            maxLength={6}
            aria-invalid={Boolean(errors.pincode)}
            {...register("pincode")}
          />
        </FormField>

        <FormField
          label="Hospital phone"
          htmlFor="phone"
          error={errors.phone?.message}
        >
          <Input
            id="phone"
            inputMode="tel"
            placeholder="9876543210"
            aria-invalid={Boolean(errors.phone)}
            {...register("phone")}
          />
        </FormField>

        <FormField
          label="Hospital email"
          htmlFor="email"
          error={errors.email?.message}
        >
          <Input
            id="email"
            type="email"
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
        </FormField>

        <FormField
          label="Website"
          htmlFor="website"
          optional
          error={errors.website?.message}
        >
          <Input
            id="website"
            placeholder="https://"
            aria-invalid={Boolean(errors.website)}
            {...register("website")}
          />
        </FormField>

        <div className="mb-3 mt-3 sm:col-span-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
            Claims desk contact
          </div>
        </div>

        <FormField
          label="Contact name"
          htmlFor="deskContactName"
          hint="Usually the desk head — whoever a TPA calls about a claim"
          error={errors.deskContactName?.message}
          className="sm:col-span-2"
        >
          <Input
            id="deskContactName"
            aria-invalid={Boolean(errors.deskContactName)}
            {...register("deskContactName")}
          />
        </FormField>

        <FormField
          label="Contact phone"
          htmlFor="deskContactPhone"
          error={errors.deskContactPhone?.message}
        >
          <Input
            id="deskContactPhone"
            inputMode="tel"
            aria-invalid={Boolean(errors.deskContactPhone)}
            {...register("deskContactPhone")}
          />
        </FormField>

        <FormField
          label="Contact email"
          htmlFor="deskContactEmail"
          error={errors.deskContactEmail?.message}
        >
          <Input
            id="deskContactEmail"
            type="email"
            aria-invalid={Boolean(errors.deskContactEmail)}
            {...register("deskContactEmail")}
          />
        </FormField>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-5">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Finish setup"}
        </Button>
      </div>
    </form>
  );
}
