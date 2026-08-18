-- ============================================================
-- RLS Migration: per-user access policies for files_metadata
--
-- Run this in the Supabase SQL Editor to replace the wide-open
-- development policy with per-user policies that restrict rows
-- to the uploading user (matched by email from the JWT).
-- ============================================================

-- Grant permissions to authenticated role and service_role
grant select, insert, update, delete on table public.files_metadata to authenticated;
grant select, insert, update, delete on table public.files_metadata to service_role;

-- Drop old policies if they exist (allows clean re-execution)
drop policy if exists "permissive_all_access" on public.files_metadata;
drop policy if exists "users_select_own_files" on public.files_metadata;
drop policy if exists "users_insert_own_files" on public.files_metadata;
drop policy if exists "users_update_own_files" on public.files_metadata;
drop policy if exists "users_delete_own_files" on public.files_metadata;

-- Per-user policies based on email from JWT
create policy "users_select_own_files"
  on public.files_metadata for select
  to authenticated
  using (uploaded_by = auth.jwt() ->> 'email');

create policy "users_insert_own_files"
  on public.files_metadata for insert
  to authenticated
  with check (uploaded_by = auth.jwt() ->> 'email');

create policy "users_update_own_files"
  on public.files_metadata for update
  to authenticated
  using (uploaded_by = auth.jwt() ->> 'email');

create policy "users_delete_own_files"
  on public.files_metadata for delete
  to authenticated
  using (uploaded_by = auth.jwt() ->> 'email');
