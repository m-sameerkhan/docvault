-- ============================================================
-- Supabase schema for the file manager
-- Run this in the Supabase SQL editor.
-- Requires: pgcrypto extension (enables gen_random_uuid()).
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Table: files_metadata
-- ------------------------------------------------------------
create table if not exists public.files_metadata (
  id          uuid primary key default gen_random_uuid(),
  filename    text not null,
  storage_path text not null unique,
  file_type   text not null,
  file_size   bigint not null,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  validated   boolean not null default false,
  notes       text
);

-- Keep updated_at fresh on row updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_files_metadata_updated_at on public.files_metadata;
create trigger trg_files_metadata_updated_at
  before update on public.files_metadata
  for each row
  execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
alter table public.files_metadata enable row level security;

-- PERMISSIVE policy for now.
-- WARNING: this lets anyone with the anon key read/write rows.
-- For production, replace the "true" with auth checks, e.g.:
--   using (auth.uid() = uploaded_by::uuid)
--   with check (auth.uid() = uploaded_by::uuid)
create policy "permissive_all_access"
  on public.files_metadata
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- ------------------------------------------------------------
-- Storage bucket: "documents" (private)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Service role bypasses storage RLS, so no storage policy is needed
-- for the API routes / Edge Function (they use the service role key).
-- If you later authenticate end users directly, add storage policies:
--   create policy "documents_full_access" on storage.objects
--     for all using (bucket_id = 'documents') with check (bucket_id = 'documents');

-- ------------------------------------------------------------
-- Note: the validate-upload Edge Function uses the service role
-- key, so it bypasses RLS. The permissive policy above is a
-- development convenience; tighten it before production.
-- ------------------------------------------------------------