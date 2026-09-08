-- ============================================================================
-- 003_data_uploads.sql
-- Records which Excel file produced each day's price_data, and who uploaded it.
--
-- Replaces the old client-side `localStorage['upload_metadata']` hack, which was
-- per-browser: the upload history filename column was blank on every other
-- device. This table is shared and RLS-protected.
-- ============================================================================

create table if not exists public.data_uploads (
  date        date primary key,
  filename    text,
  uploaded_by text,
  row_count   integer,
  created_at  timestamptz not null default now()
);

comment on table public.data_uploads is
  'One row per price_data date: source spreadsheet name, uploader email, row count.';

alter table public.data_uploads enable row level security;

drop policy if exists data_uploads_select on public.data_uploads;
create policy data_uploads_select on public.data_uploads
  for select to authenticated
  using (public.is_allowed_user());

drop policy if exists data_uploads_write on public.data_uploads;
create policy data_uploads_write on public.data_uploads
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Optional: keep data_uploads in sync when an admin deletes a day of price_data
-- from the history table.
create or replace function public.trg_prune_data_uploads()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.price_data where date = old.date) then
    delete from public.data_uploads where date = old.date;
  end if;
  return old;
end;
$$;

drop trigger if exists prune_data_uploads on public.price_data;
create trigger prune_data_uploads
  after delete on public.price_data
  for each row execute function public.trg_prune_data_uploads();
