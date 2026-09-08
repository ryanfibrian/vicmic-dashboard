-- ============================================================================
-- 004_settings_seed.sql
-- Moves the courier commission rate out of the JavaScript (it was hard-coded as
-- `* 300` in three places) into app_settings so an admin can change it from the
-- Pengaturan page without a redeploy.
-- ============================================================================

insert into public.app_settings (setting_key, setting_value)
values ('courier_rate_per_km', '300')
on conflict (setting_key) do nothing;
