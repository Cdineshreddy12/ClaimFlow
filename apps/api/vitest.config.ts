import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // No feature modules yet — don't fail CI on an empty suite, but do
    // fail it the moment a test file exists and fails.
    passWithNoTests: true,

    // The *.integration.test.ts files talk to the real Supabase instance
    // in Mumbai, so a single transaction is several ~300-600ms round
    // trips. Vitest runs test files in parallel by default, and the
    // resulting contention pushed individual cases past the 5s default
    // even though each file passes comfortably on its own. 30s is far
    // above the real worst case while still catching a genuine hang.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
