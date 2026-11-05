import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Loader } from "../../components/ui/loader";
import {
  useHospital,
  useUpdateProfile,
  type ProfileStepPayload,
} from "../hospital/api";
import { ComplianceStep } from "./steps/ComplianceStep";
import { ContactStep } from "./steps/ContactStep";
import { IdentityStep } from "./steps/IdentityStep";
import { BrandMark, BrandName } from "@/components/ui/brand";

const STEPS = [
  { key: "identity", name: "Identity" },
  { key: "compliance", name: "Compliance" },
  { key: "contact", name: "Contact" },
] as const;

export function ProfileWizardPage() {
  const navigate = useNavigate();
  const { data: hospital, isLoading } = useHospital();
  const updateProfile = useUpdateProfile();
  const [stepIndex, setStepIndex] = useState(0);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-start justify-center px-6 pb-16 pt-10">
        <Loader />
      </div>
    );
  }

  if (!hospital) {
    return (
      <div className="flex min-h-screen items-start justify-center px-6 pb-16 pt-10">
        <div className="w-full max-w-[680px]">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
            Couldn't load your hospital.
          </div>
        </div>
      </div>
    );
  }

  // Already finished — revisiting the URL shouldn't re-run setup.
  if (hospital.onboardingCompletedAt) return <Navigate to="/" replace />;

  async function save(payload: ProfileStepPayload, isLast: boolean) {
    await updateProfile.mutateAsync(payload);
    if (isLast) navigate("/");
    else setStepIndex((i) => i + 1);
  }

  const current = STEPS[stepIndex]!;

  return (
    <div className="flex min-h-screen items-start justify-center px-6 pb-16 pt-10">
      <div className="w-full max-w-[680px]">
        <div className="mb-[22px] flex items-center justify-center gap-2">
          <BrandMark />
          <BrandName />
        </div>

        <h1 className="mb-1 text-center text-xl font-semibold tracking-[-0.01em]">
          Set up {hospital.name}
        </h1>
        <p className="mb-6 text-center text-base text-ink-faint">
          A few details insurers need before you can run cashless claims.
        </p>

        <div className="my-6 mb-7 flex gap-1.5 sm:gap-2">
          {STEPS.map((step, i) => (
            <div key={step.key} className="flex flex-1 flex-col gap-[7px]">
              <div
                className={`h-[3px] rounded-[2px] ${
                  i < stepIndex
                    ? "bg-approved"
                    : i === stepIndex
                      ? "bg-accent"
                      : "bg-line-strong"
                }`}
              />
              <span
                className={`text-2xs font-semibold uppercase tracking-[0.05em] sm:text-xs ${
                  i < stepIndex
                    ? "text-approved"
                    : i === stepIndex
                      ? "text-accent-ink"
                      : "text-ink-faint"
                }`}
              >
                {step.name}
              </span>
            </div>
          ))}
        </div>

        {updateProfile.isError ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
            {updateProfile.error instanceof Error
              ? updateProfile.error.message
              : "Couldn't save — try again."}
          </div>
        ) : null}

        {current.key === "identity" ? (
          <IdentityStep
            hospital={hospital}
            isSaving={updateProfile.isPending}
            onSubmit={(data) => void save({ step: "identity", data }, false)}
          />
        ) : null}

        {current.key === "compliance" ? (
          <ComplianceStep
            hospital={hospital}
            isSaving={updateProfile.isPending}
            onBack={() => setStepIndex((i) => i - 1)}
            onSubmit={(data) => void save({ step: "compliance", data }, false)}
          />
        ) : null}

        {current.key === "contact" ? (
          <ContactStep
            hospital={hospital}
            isSaving={updateProfile.isPending}
            onBack={() => setStepIndex((i) => i - 1)}
            onSubmit={(data) => void save({ step: "contact", data }, true)}
          />
        ) : null}
      </div>
    </div>
  );
}
