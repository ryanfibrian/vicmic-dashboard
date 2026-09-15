-- ============================================================================
-- 009_fix_courier_positions_trip_id.sql — courier_positions.trip_id was
-- declared bigint (008), guessing courier_logs.id was a plain integer
-- identity column. It's actually a UUID — confirmed by the real error this
-- produced in production: `invalid input syntax for type bigint:
-- "4be3606f-2ece-448c-8534-7d7d22c7c1c4"`.
--
-- Every insert into this column has been failing since 008 was applied (the
-- app only logs the failure to the console, never surfaces it), so the table
-- is empty in practice — this migration is safe to run any time.
--
-- Using text rather than uuid: it compares correctly against a uuid value in
-- a PostgREST .eq() filter either way, and doesn't require confirming
-- courier_logs.id's exact declared type (which, like the table itself,
-- predates the migrations folder and was never verified here).
-- ============================================================================

alter table public.courier_positions
  alter column trip_id type text using trip_id::text;
