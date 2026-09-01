-- toolgraph: extensions and shared helpers.
--
-- Runs first. Everything here is idempotent so `supabase db reset`, a fresh
-- `db push` and a re-run against an existing database all behave identically.
--
-- These migrations target a Supabase database, not a bare Postgres. Later files
-- reference auth.users and grant to the `anon` and `authenticated` roles, none
-- of which this file creates — Supabase provisions them before the first
-- migration runs. Applying this set to a stock Postgres fails on those
-- references, which is the intended behaviour: the RLS design has no meaning
-- without those roles.

-- Already present on a Supabase project; created here only so the `with schema`
-- clause below has somewhere to put the extension on a database where the
-- bootstrap left it out.
create schema if not exists extensions;

-- gen_random_uuid() lives in pg_catalog from Postgres 13 on, so the unqualified
-- calls in every table default below resolve without help from search_path.
-- (supabase/config.toml pins major_version 17.) pgcrypto is installed anyway
-- because it is the sanctioned home for digest()/crypt() should a later
-- migration need them.
create extension if not exists pgcrypto with schema extensions;

-- Shared trigger helper. Used by the `graphs` and `mcp_server_connections`
-- triggers in 20260101000300_triggers.sql.
--
-- `security definer` with `set search_path = ''` is the pair that matters: the
-- empty search_path means an unprivileged caller cannot shadow an unqualified
-- name with an object in a schema they control, which is the classic way a
-- definer-rights function gets turned into privilege escalation. Every
-- non-pg_catalog reference in this file is therefore schema-qualified.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger helper: stamps updated_at with the statement timestamp. '
  'Clients cannot set updated_at themselves — the trigger always overwrites it.';

-- Postgres checks EXECUTE on a trigger function at CREATE TRIGGER time, not on
-- every fire, so dropping the public grant here does not stop the triggers in
-- 20260101000300 from running. It does stop an authenticated user calling a
-- definer-rights function directly over PostgREST.
revoke all on function public.set_updated_at() from public;
