import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors vite.config.ts and tsconfig.json. Tests import components
  // that import `@/...`, and without this they resolve at build time
  // and fail under the test runner — three places to keep in step,
  // which is one of the costs of a separate test config.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // No feature modules yet — don't fail CI on an empty suite, but do
    // fail it the moment a test file exists and fails.
    passWithNoTests: true,
    /**
     * happy-dom, and everywhere rather than per-file pragmas.
     *
     * jsdom was the first choice and pulls in an undici that throws on
     * load under this Node — happy-dom has no such dependency, and is
     * faster besides. The pure-logic suites run identically under it,
     * and a component test that forgets a pragma fails with "document
     * is not defined", which reads as a broken component rather than a
     * missing comment.
     */
    environment: "happy-dom",
    /**
     * Placeholders, because the Supabase client is constructed at
     * module load and validates its URL — so any test that reaches
     * api-client, directly or through a component, fails to collect
     * without them. Nothing in a test should ever reach the network;
     * these exist to get past a constructor.
     */
    env: {
      VITE_SUPABASE_URL: "http://localhost/supabase",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
      VITE_API_URL: "http://localhost/api",
    },
    setupFiles: ["./src/test/setup.ts"],
  },
});
