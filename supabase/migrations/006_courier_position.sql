-- ============================================================================
-- 006_courier_position.sql — live GPS position for an active courier trip.
--
-- No new table and no new RLS: courier_logs_update already lets a courier
-- write to their own row (or an admin to any row), which is exactly what a
-- position ping while status = 'sedang jalan' needs.
-- ============================================================================

alter table public.courier_logs
  add column if not exists last_lat double precision,
  add column if not exists last_lng double precision,
  add column if not exists last_ping_at timestamptz;
