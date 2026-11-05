import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const envDir = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Hands the local sign-in bypass to the dev server, and only the dev
 * server.
 *
 * `apply: "serve"` is the whole point: this plugin does not exist in a
 * production build, so there is no path by which the token reaches a
 * built bundle. The matching `define` below pins `__DEV_TOKEN__` to an
 * empty string for builds.
 *
 * It's injected as a global rather than relied on through `define`
 * because Vite does not substitute custom defines into dev-served
 * source modules — verified by probing the dev server, after the
 * version that assumed otherwise crashed the app with a
 * ReferenceError.
 */
function devTokenGlobal(token: string): Plugin {
  return {
    name: "claimflow:dev-token-global",
    apply: "serve",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          injectTo: "head-prepend",
          children: `globalThis.__DEV_TOKEN__=${JSON.stringify(token)};`,
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "");
  const devToken = mode === "production" ? "" : (env.VITE_DEV_TOKEN ?? "");

  return {
    plugins: [react(), devTokenGlobal(devToken)],
    // Reads the monorepo's single root .env instead of needing its own —
    // same file apps/api loads, see .env.example.
    envDir,
    define: {
      /**
       * Build-time value only. Always empty: a signed org_admin JWT must
       * never be written into the shipped JavaScript.
       *
       * Reading it straight from `import.meta.env.VITE_DEV_TOKEN` in
       * application code does exactly that, and guarding the read with
       * `import.meta.env.DEV` does NOT help — Vite inlines the literal
       * and the minifier hoists it to a const before folding the dead
       * branch, so the credential ships anyway. Confirmed by grepping
       * dist. Keeping the name out of `import.meta.env` entirely is the
       * only reliable fix.
       */
      __DEV_TOKEN__: '""',
    },
    resolve: {
      // Mirrors the "@/*" path in tsconfig.json — without it the alias
      // typechecks but fails to resolve at runtime.
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5175,
    },
  };
});
