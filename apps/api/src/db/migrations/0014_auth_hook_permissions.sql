-- Let the Custom Access Token hook actually read the table it queries.
--
-- Migration 0002 created `public.custom_access_token_hook` as SECURITY
-- INVOKER and granted EXECUTE to supabase_auth_admin, which is the role
-- Supabase's auth service runs it as. That role is not a superuser and
-- does not have BYPASSRLS, and nothing ever granted it SELECT on
-- org_members — so the hook's own query raised "permission denied" and
-- every sign-in came back as:
--
--   error_code=unexpected_failure
--   error_description=Error running hook URI: pg-functions://...
--
-- It went unnoticed because local development authenticates with
-- VITE_DEV_TOKEN (see .env.example), which skips Supabase sign-in
-- entirely — the hook is only reached by a real login.
--
-- Both halves are needed: the GRANT for the table privilege, and the
-- policy because RLS is enabled on the table and supabase_auth_admin
-- does not bypass it.

grant usage on schema public to supabase_auth_admin;
--> statement-breakpoint
grant select on table public.org_members to supabase_auth_admin;
--> statement-breakpoint
drop policy if exists "auth admin reads memberships" on public.org_members;
--> statement-breakpoint
create policy "auth admin reads memberships" on public.org_members
  as permissive for select to supabase_auth_admin using (true);
