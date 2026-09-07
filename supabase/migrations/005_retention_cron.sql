-- ============================================================================
-- 005_retention_cron.sql   (OPTIONAL but recommended)
--
-- Moves data retention off the client. Today every page load, for every user,
-- runs DB.cleanupOldData(60) and Courier.cleanupOldLogs() -- dozens of DELETE
-- scans a day, racy, and now blocked for non-admins by RLS anyway.
--
-- This schedules the same cleanup as two nightly pg_cron jobs instead. After
-- applying, the client-side cleanup calls are removed in the frontend.
--
-- Requires the pg_cron extension. On Supabase: Dashboard -> Database ->
-- Extensions -> enable "pg_cron" (or run the create extension below).
-- ============================================================================

create extension if not exists pg_cron;

-- Price data older than 60 days.
select cron.schedule(
  'vicmic-prune-price-data',
  '15 18 * * *',  -- 18:15 UTC ~ 01:15 WIB
  $$ delete from public.price_data where date < (current_date - interval '60 days') $$
);

-- Courier logs older than 90 days.
select cron.schedule(
  'vicmic-prune-courier-logs',
  '20 18 * * *',
  $$ delete from public.courier_logs where date < (current_date - interval '90 days') $$
);

-- To inspect or remove later:
--   select * from cron.job;
--   select cron.unschedule('vicmic-prune-price-data');
--   select cron.unschedule('vicmic-prune-courier-logs');
