import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // No feature modules yet — don't fail CI on an empty suite, but do
    // fail it the moment a test file exists and fails.
    passWithNoTests: true,
  },
});
