import { createBrowserRouter } from "react-router-dom";
import { ClaimFilePage } from "../features/claims/ClaimFilePage";
import { DashboardPage } from "../features/dashboard/DashboardPage";

export const router: ReturnType<typeof createBrowserRouter> =
  createBrowserRouter([
    { path: "/", element: <DashboardPage /> },
    { path: "/claims/:id", element: <ClaimFilePage /> },
  ]);
