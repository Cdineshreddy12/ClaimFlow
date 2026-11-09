import { defineConfig } from "tsup";

/**
 * Builds the server into something Node can actually run.
 *
 * `tsc -b` emitted JS that still imported `@claimflow/contracts`, and
 * that package's `main` is `./src/index.ts` — TypeScript source, with
 * no build of its own. Node refuses it:
 *
 *     Unknown file extension ".ts" for packages/contracts/src/index.ts
 *
 * which is why `node dist/server.js` never worked despite the build
 * reporting success. Pointing contracts at a compiled `dist` instead
 * would fix the server and cost the web app and the test suite their
 * direct read of the source, so the workspace package is compiled into
 * the bundle here and nothing else changes.
 *
 * Only the workspace package. Every npm dependency stays a real import
 * resolved from `node_modules` at runtime — bundling `@aws-sdk`,
 * `postgres` and `pdf-lib` into one file buys nothing and breaks the
 * ones that resolve files relative to themselves.
 */
export default defineConfig({
  entry: ["src/server.ts"],
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node20",
  noExternal: ["@claimflow/contracts"],
  sourcemap: true,
  clean: true,
});
