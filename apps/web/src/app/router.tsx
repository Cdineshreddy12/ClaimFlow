import { createBrowserRouter } from "react-router-dom";
import { NotFoundPage, RouteErrorPage } from "./NotFoundPage";
import { ClaimFilePage } from "../features/claims/ClaimFilePage";
import { ClaimsListPage } from "../features/claims/ClaimsListPage";
import { NewClaimPage } from "../features/claims/NewClaimPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { QueryInboxPage } from "../features/queries/QueryInboxPage";
import { SlaPage } from "../features/sla/SlaPage";
import { ReceivablesPage } from "../features/receivables/ReceivablesPage";
import { ChecklistAdminPage } from "../features/checklist/ChecklistAdminPage";
import { CustomModulePage } from "../features/custom/CustomModulePage";
import { CustomRecordPage } from "../features/custom/CustomRecordPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { BrandingSettingsPage } from "../features/hospital/BrandingSettingsPage";
import { DoctorApprovalPage } from "../features/doctor-approval/DoctorApprovalPage";
import { LoginPage } from "../features/auth/LoginPage";
import { SignupPage } from "../features/auth/SignupPage";
import { AcceptInvitePage } from "../features/onboarding/AcceptInvitePage";
import { ProfileWizardPage } from "../features/onboarding/ProfileWizardPage";
import {
  RequireAuth,
  RequireCompleteProfile,
  RequireMembership,
} from "./RequireAuth";

export const router: ReturnType<typeof createBrowserRouter> =
  createBrowserRouter([
    {
      // Catches a thrown render as well as a bad address — without it
      // React Router shows its own "Hey developer" screen to a desk
      // executive.
      errorElement: <RouteErrorPage />,
      children: [
        { path: "/login", element: <LoginPage /> },
        { path: "/signup", element: <SignupPage /> },
        { path: "/invites/:token", element: <AcceptInvitePage /> },
        // Public: a doctor opens this from a phone link with no account.
        { path: "/doctor-approval/:token", element: <DoctorApprovalPage /> },
        {
          element: <RequireAuth />,
          children: [
            {
              element: <RequireMembership />,
              children: [
                { path: "/onboarding/profile", element: <ProfileWizardPage /> },
                {
                  element: <RequireCompleteProfile />,
                  children: [
                    { path: "/", element: <DashboardPage /> },
                    { path: "/claims", element: <ClaimsListPage /> },
                    // Ahead of /claims/:id so the intent is obvious on
                    // reading, though React Router ranks the static
                    // segment higher either way.
                    { path: "/claims/new", element: <NewClaimPage /> },
                    { path: "/claims/:id", element: <ClaimFilePage /> },
                    { path: "/queries", element: <QueryInboxPage /> },
                    { path: "/sla", element: <SlaPage /> },
                    { path: "/receivables", element: <ReceivablesPage /> },
                    { path: "/checklist", element: <ChecklistAdminPage /> },
                    { path: "/reports", element: <ReportsPage /> },
                    // One route for every module a hospital invents —
                    // the page reads its shape from the slug.
                    { path: "/m/:slug", element: <CustomModulePage /> },
                    // Ahead of the record id so the intent is obvious
                    // on reading, though React Router ranks the static
                    // segment higher either way — same as /claims/new.
                    { path: "/m/:slug/new", element: <CustomRecordPage /> },
                    {
                      path: "/m/:slug/:recordId",
                      element: <CustomRecordPage />,
                    },
                    {
                      path: "/settings/branding",
                      element: <BrandingSettingsPage />,
                    },
                    // Last: anything that matched nothing above. Inside the
                    // auth tree on purpose, so a signed-out visitor still
                    // lands on the login page rather than a 404 about a
                    // screen they were never going to see.
                    { path: "*", element: <NotFoundPage /> },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
