import { createBrowserRouter } from "react-router-dom";
import { ClaimFilePage } from "../features/claims/ClaimFilePage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { QueryInboxPage } from "../features/queries/QueryInboxPage";
import { ChecklistAdminPage } from "../features/checklist/ChecklistAdminPage";
import { DoctorApprovalPage } from "../features/doctor-approval/DoctorApprovalPage";
import { LoginPage } from "../features/auth/LoginPage";
import { SignupPage } from "../features/auth/SignupPage";
import { AcceptInvitePage } from "../features/onboarding/AcceptInvitePage";
import { CreateOrganizationPage } from "../features/onboarding/CreateOrganizationPage";
import { ProfileWizardPage } from "../features/onboarding/ProfileWizardPage";
import { RequireAuth, RequireCompleteProfile, RequireOrg } from "./RequireAuth";

export const router: ReturnType<typeof createBrowserRouter> =
  createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
    { path: "/signup", element: <SignupPage /> },
    { path: "/invites/:token", element: <AcceptInvitePage /> },
    // Public: a doctor opens this from a phone link with no account.
    { path: "/doctor-approval/:token", element: <DoctorApprovalPage /> },
    {
      element: <RequireAuth />,
      children: [
        {
          path: "/onboarding/organization",
          element: <CreateOrganizationPage />,
        },
        {
          element: <RequireOrg />,
          children: [
            { path: "/onboarding/profile", element: <ProfileWizardPage /> },
            {
              element: <RequireCompleteProfile />,
              children: [
                { path: "/", element: <DashboardPage /> },
                { path: "/claims/:id", element: <ClaimFilePage /> },
                { path: "/queries", element: <QueryInboxPage /> },
                { path: "/checklist", element: <ChecklistAdminPage /> },
              ],
            },
          ],
        },
      ],
    },
  ]);
