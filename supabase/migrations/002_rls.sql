-- ============================================================================
-- 002_rls.sql
-- Enables Row Level Security on every application table and defines policies.
--
-- BEFORE THIS MIGRATION: any holder of the public anon key can read (and likely
-- write) every row in every table, including cost prices (price_data.distribusi)
-- and the user/role list. AFTER: only authenticated users whose Google email is
-- present in allowed_users can read business data; only admins can write it.
--
-- Requires: 001_helpers.sql, and Google auth enabled (see supabase/SETUP.md) so
-- that auth.jwt() carries a real email.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- allowed_users : whitelist of Google accounts and their role.
-- ---------------------------------------------------------------------------
alter table public.allowed_users enable row level security;

drop policy if exists allowed_users_select on public.allowed_users;
create policy allowed_users_select on public.allowed_users
  for select to authenticated
  using (public.is_admin() or email = public.jwt_email());

drop policy if exists allowed_users_insert on public.allowed_users;
create policy allowed_users_insert on public.allowed_users
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists allowed_users_update on public.allowed_users;
create policy allowed_users_update on public.allowed_users
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists allowed_users_delete on public.allowed_users;
create policy allowed_users_delete on public.allowed_users
  for delete to authenticated
  using (public.is_admin() and not is_super_admin);

-- ---------------------------------------------------------------------------
-- price_data : daily price / stock rows. Readable by any whitelisted user,
-- writable only by admins.
-- ---------------------------------------------------------------------------
alter table public.price_data enable row level security;

drop policy if exists price_data_select on public.price_data;
create policy price_data_select on public.price_data
  for select to authenticated
  using (public.is_allowed_user());

drop policy if exists price_data_write on public.price_data;
create policy price_data_write on public.price_data
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- app_settings : price formulas, courier rate, etc.
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated
  using (public.is_allowed_user());

drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- courier_logs : a courier sees only their own rows; admins see everything.
-- ---------------------------------------------------------------------------
alter table public.courier_logs enable row level security;

drop policy if exists courier_logs_select on public.courier_logs;
create policy courier_logs_select on public.courier_logs
  for select to authenticated
  using (public.is_admin() or user_email = public.jwt_email());

drop policy if exists courier_logs_insert on public.courier_logs;
create policy courier_logs_insert on public.courier_logs
  for insert to authenticated
  with check (user_email = public.jwt_email() or public.is_admin());

drop policy if exists courier_logs_update on public.courier_logs;
create policy courier_logs_update on public.courier_logs
  for update to authenticated
  using (public.is_admin() or user_email = public.jwt_email())
  with check (public.is_admin() or user_email = public.jwt_email());

drop policy if exists courier_logs_delete on public.courier_logs;
create policy courier_logs_delete on public.courier_logs
  for delete to authenticated
  using (public.is_admin() or user_email = public.jwt_email());

-- ---------------------------------------------------------------------------
-- get_distinct_dates() : list of dates that have price_data, newest first.
-- Recreated as SECURITY INVOKER so it runs with the caller's RLS. Anonymous
-- callers now get an empty set instead of the full date history.
-- ---------------------------------------------------------------------------
create or replace function public.get_distinct_dates()
returns table (date date)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct pd.date from public.price_data pd order by pd.date desc
$$;

revoke all on function public.get_distinct_dates() from public, anon;
grant execute on function public.get_distinct_dates() to authenticated;
