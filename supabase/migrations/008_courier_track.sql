-- ============================================================================
-- 008_courier_track.sql — GPS breadcrumb trail per trip, for the admin
-- dashboard's "lihat rute" feature (draws the actual path a courier drove,
-- not just their current dot or a straight/road-guessed line).
--
-- Separate from courier_logs.last_lat/last_lng (migration 006), which only
-- ever holds the *latest* position for the live map. This table accumulates
-- one row per GPS ping so the whole trip can be redrawn afterwards.
--
-- trip_id intentionally has no foreign-key constraint to courier_logs.id —
-- that table predates the migrations folder (created directly in the
-- Supabase dashboard), so its exact id column type was never verified here;
-- a mismatched FK type would fail this migration outright. The app always
-- writes real courier_logs ids, so a plain column is enough.
-- ============================================================================

create table if not exists public.courier_positions (
  id bigint generated always as identity primary key,
  trip_id bigint not null,
  user_email text not null,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz not null default now()
);

create index if not exists courier_positions_trip_id_idx
  on public.courier_positions (trip_id, recorded_at);

alter table public.courier_positions enable row level security;

drop policy if exists courier_positions_select on public.courier_positions;
create policy courier_positions_select on public.courier_positions
  for select to authenticated
  using (public.is_admin() or user_email = public.jwt_email());

drop policy if exists courier_positions_insert on public.courier_positions;
create policy courier_positions_insert on public.courier_positions
  for insert to authenticated
  with check (user_email = public.jwt_email() or public.is_admin());

drop policy if exists courier_positions_delete on public.courier_positions;
create policy courier_positions_delete on public.courier_positions
  for delete to authenticated
  using (public.is_admin());

-- Retention (optional, run separately): kept out of this file so a missing
-- pg_cron extension can't roll back the table/RLS above with it — Supabase's
-- SQL Editor runs a whole pasted script as one transaction. Needs pg_cron
-- enabled first (Database -> Extensions), same as migration 005.
--
--   select cron.schedule(
--     'vicmic-prune-courier-positions',
--     '30 19 * * *', -- 02:30 WIB
--     $$ delete from public.courier_positions where recorded_at < (now() - interval '14 days') $$
--   );
