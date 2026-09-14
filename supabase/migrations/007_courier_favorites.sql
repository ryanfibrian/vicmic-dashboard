-- ============================================================================
-- 007_courier_favorites.sql — saved addresses for the Vicmic Kurir Android
-- app's map picker (android-kurir/), so a courier can reuse a place without
-- retyping/re-picking it every time. Separate from courier_logs history —
-- the courier explicitly chooses what to save here.
--
-- Same ownership model as courier_logs: a courier sees/manages only their
-- own rows; admins see everything.
-- ============================================================================

create table if not exists public.courier_favorite_addresses (
  id bigint generated always as identity primary key,
  user_email text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

create index if not exists courier_favorite_addresses_user_email_idx
  on public.courier_favorite_addresses (user_email);

alter table public.courier_favorite_addresses enable row level security;

drop policy if exists courier_favorite_addresses_select on public.courier_favorite_addresses;
create policy courier_favorite_addresses_select on public.courier_favorite_addresses
  for select to authenticated
  using (public.is_admin() or user_email = public.jwt_email());

drop policy if exists courier_favorite_addresses_insert on public.courier_favorite_addresses;
create policy courier_favorite_addresses_insert on public.courier_favorite_addresses
  for insert to authenticated
  with check (user_email = public.jwt_email() or public.is_admin());

drop policy if exists courier_favorite_addresses_delete on public.courier_favorite_addresses;
create policy courier_favorite_addresses_delete on public.courier_favorite_addresses
  for delete to authenticated
  using (public.is_admin() or user_email = public.jwt_email());
