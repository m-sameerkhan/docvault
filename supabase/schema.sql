
-- Supabase Schema & Per-User RLS Policies for DocVault
-- Run this complete script in the Supabase SQL Editor.


create extension if not exists pgcrypto;

-- Table: files_metadata

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


-- Permissions (GRANTs)

grant select, insert, update, delete on table public.files_metadata to authenticated;
grant select, insert, update, delete on table public.files_metadata to service_role;


-- Row Level Security (RLS) & Per-User Policies

alter table public.files_metadata enable row level security;

-- Drop old development policy if it exists
drop policy if exists "permissive_all_access" on public.files_metadata;

-- Drop per-user policies if they already exist (prevents error 42710)
drop policy if exists "users_select_own_files" on public.files_metadata;
drop policy if exists "users_insert_own_files" on public.files_metadata;
drop policy if exists "users_update_own_files" on public.files_metadata;
drop policy if exists "users_delete_own_files" on public.files_metadata;

-- Re-create per-user policies
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


-- Storage bucket: "documents" (private)

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;