/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * The local sign-in bypass. Set as a global by a serve-only Vite plugin
 * in dev, and defined to "" at build time — see vite.config.ts.
 *
 * Typed as possibly undefined on purpose: nothing guarantees a global
 * exists, and reading a missing one throws. Every use goes through a
 * `typeof` check.
 */
declare const __DEV_TOKEN__: string | undefined;
