import { createBrowserRouter } from "react-router-dom";
import { ClaimFilePage } from "../features/claims/ClaimFilePage";
import { ClaimsListPage } from "../features/claims/ClaimsListPage";

export const router: ReturnType<typeof createBrowserRouter> =
  createBrowserRouter([
    { path: "/", element: <ClaimsListPage /> },
    { path: "/claims/:id", element: <ClaimFilePage /> },
  ]);
