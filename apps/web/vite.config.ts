import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Reads the monorepo's single root .env instead of needing its own —
  // same file apps/api loads, see .env.example.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  server: {
    port: 5173,
  },
});
