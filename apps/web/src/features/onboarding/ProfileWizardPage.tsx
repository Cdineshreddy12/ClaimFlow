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
      <div className="wizard-shell">
        <Loader />
      </div>
    );
  }

  if (!hospital) {
    return (
      <div className="wizard-shell">
        <div className="wizard-card">
          <div className="inline-error">Couldn't load your hospital.</div>
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
    <div className="wizard-shell">
      <div className="wizard-card">
        <div className="auth-brand">
          <span className="brand-mark" />
          <span className="brand-name">Claims Desk</span>
        </div>

        <h1 className="auth-heading">Set up {hospital.name}</h1>
        <p className="auth-subheading">
          A few details insurers need before you can run cashless claims.
        </p>

        <div className="wizard-steps">
          {STEPS.map((step, i) => (
            <div
              key={step.key}
              className={`wizard-step${i < stepIndex ? " done" : ""}${i === stepIndex ? " current" : ""}`}
            >
              <div className="wizard-step-bar" />
              <span className="wizard-step-name">{step.name}</span>
            </div>
          ))}
        </div>

        {updateProfile.isError ? (
          <div className="inline-error">
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
