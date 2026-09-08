-- ============================================================================
-- 001_helpers.sql
-- Helper functions used by the Row Level Security policies in 002_rls.sql.
--
-- These run as SECURITY DEFINER so they can read `allowed_users` even while
-- RLS is enabled on it (a policy that queries the same table it protects would
-- otherwise recurse). They are STABLE and take no user input.
--
-- Apply order: run this file first, then 002_rls.sql.
-- ============================================================================

-- Email of the currently authenticated user, lower-cased. NULL when anonymous.
create or replace function public.jwt_email()
returns text
language sql
stable
as $$
  select lower(nullif(auth.jwt() ->> 'email', ''))
$$;

-- Role string from allowed_users for the current user ('admin' | 'sales' |
-- 'sales_kurir'), or NULL if the email is not whitelisted.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.allowed_users where email = public.jwt_email() limit 1
$$;

-- TRUE when the current user is a whitelisted admin.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

-- TRUE when the current user's email exists in allowed_users at all.
create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_users where email = public.jwt_email()
  )
$$;

revoke all on function public.jwt_email()          from public;
revoke all on function public.current_user_role()  from public;
revoke all on function public.is_admin()           from public;
revoke all on function public.is_allowed_user()    from public;

grant execute on function public.jwt_email()          to authenticated;
grant execute on function public.current_user_role()  to authenticated;
grant execute on function public.is_admin()           to authenticated;
grant execute on function public.is_allowed_user()    to authenticated;
