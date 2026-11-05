import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { AuthProvider } from "./features/auth/AuthProvider";
import "./styles/index.css";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/*
      Query client outermost: AuthProvider asks /me when the session's
      role claim is missing, and a hook can't reach a provider above it.
      Neither depends on the other for anything else — api-client reads
      the Supabase session directly, not this context.
    */}
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
