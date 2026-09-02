-- toolgraph: user profiles.
--
-- Two people in a workspace need to tell each other apart, and an email address
-- is both a poor label and something we would rather not spray across a members
-- list. This table holds the small amount of self-description a user can set.
--
-- It is deliberately thin. Everything that could live here and does not —
-- avatars, bios, timezones, notification preferences — is absent because none
-- of it is used, and a settings screen full of toggles that change nothing is
-- worse than one with four that work.

create table if not exists public.profiles (
  -- Same id as the auth user, so there is no join key to keep in sync and no
  -- way for a profile to outlive its account.
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

comment on table public.profiles is
  'Optional display name for a user. Readable by anyone who shares a workspace with them, so a members list can show a name instead of an email address.';

revoke all on table public.profiles from anon;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

-- Readable by yourself, and by people you actually share a workspace with. The
-- second disjunct is scoped through workspace_members on BOTH sides, so it
-- cannot be used to enumerate the user table: there is no way to ask "does this
-- id exist" without already being in a room with them.
drop policy if exists profiles_select_self_or_shared_workspace on public.profiles;
create policy profiles_select_self_or_shared_workspace
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.workspace_members mine
      join public.workspace_members theirs
        on theirs.workspace_id = mine.workspace_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = profiles.id
    )
  );

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists profiles_delete_self on public.profiles;
create policy profiles_delete_self
  on public.profiles
  for delete
  to authenticated
  using (id = (select auth.uid()));

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

/* -------------------------------------------------------------------------- */
/* The membership view the app actually needs                                  */
/* -------------------------------------------------------------------------- */

-- A members list wants (name, email, role). Role is in workspace_members, name
-- is in profiles, and email is in auth.users — which `authenticated` cannot
-- read, correctly.
--
-- Rather than granting access to auth.users, this function returns exactly the
-- three fields, and only for a workspace the caller is already a member of. It
-- is `security definer` for the auth.users read and gates on
-- is_workspace_member() first, so it cannot be used to look up an address for
-- any workspace the caller is not in.
create or replace function public.workspace_member_list(target uuid)
returns table (user_id uuid, email text, display_name text, role text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(target) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  return query
  select
    m.user_id,
    u.email::text,
    p.display_name,
    m.role,
    m.created_at
  from public.workspace_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.workspace_id = target
  order by
    case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    m.created_at;
end;
$$;

revoke all on function public.workspace_member_list(uuid) from public;
grant execute on function public.workspace_member_list(uuid) to authenticated, service_role;

comment on function public.workspace_member_list(uuid) is
  'Name, email and role for one workspace''s members. Definer-rights because it reads auth.users, and gated on is_workspace_member() first so it cannot be used to look up an address outside a workspace the caller is in.';
