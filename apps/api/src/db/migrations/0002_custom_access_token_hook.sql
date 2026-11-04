-- Custom Access Token Auth Hook.
--
-- Supabase calls this function at sign-in/token-refresh and lets it rewrite
-- the JWT claims before the token is issued. We use it to stamp
-- organization_id and our app role onto app_metadata, which is what both
-- apps/api/src/plugins/jwt.ts (Fastify) and the RLS policies in
-- 0001_row_level_security.sql read.
--
-- IMPORTANT, one manual step this migration can't do: Supabase only calls
-- this function if it's enabled as a Custom Access Token hook in the
-- project dashboard (Authentication -> Hooks -> Custom Access Token ->
-- select public.custom_access_token_hook). That's a dashboard toggle, not
-- SQL, and has to be done once per Supabase project. Until it's enabled,
-- JWTs won't carry organization_id/role and apps/api/src/plugins/jwt.ts
-- will reject every request with 403.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  member record;
begin
  select organization_id, role into member
  from public.org_members
  where user_id = (event->>'user_id')::uuid
  limit 1;

  claims := event->'claims';

  if member.organization_id is not null then
    claims := jsonb_set(claims, '{app_metadata,organization_id}', to_jsonb(member.organization_id::text));
    claims := jsonb_set(claims, '{app_metadata,role}', to_jsonb(member.role::text));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- Only Supabase's own auth service may call this — never application roles.
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
