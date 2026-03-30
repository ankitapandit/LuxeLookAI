-- ═══════════════════════════════════════════════════════════════════════════════
-- LuxeLook AI — Supabase Manual Changes
-- ═══════════════════════════════════════════════════════════════════════════════
-- This file documents every change made directly in the Supabase dashboard
-- or SQL Editor across all versions. Run sections in order on a fresh project.
-- Safe to re-run — all statements use IF NOT EXISTS / OR REPLACE / ON CONFLICT.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- v1.1 — Initial schema (from schema.sql)
-- Run backend/schema.sql first for base tables, indexes and RLS.
-- The changes below are additions made after the initial schema was applied.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- v1.2 — Auth trigger + RLS policies + column additions
-- ─────────────────────────────────────────────────────────────────────────────

-- Auto-insert into public.users when a new Supabase Auth user signs up.
-- Prevents foreign key violations on clothing_items, events etc.
create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Manually backfill any existing auth users who signed up before the trigger
insert into public.users (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Make the users FK deferrable to avoid timing issues during signup
alter table public.users
  drop constraint if exists users_id_fkey;

alter table public.users
  add constraint users_id_fkey
  foreign key (id)
  references auth.users(id)
  on delete cascade
  deferrable initially deferred;

-- RLS: allow service role to insert into all tables
-- (backend uses service role key which should bypass RLS,
-- but Supabase sometimes requires explicit policies)

create policy "Service role can insert users"
  on public.users for insert
  to service_role
  with check (true);

create policy "Service role can insert clothing"
  on public.clothing_items for insert
  to service_role
  with check (true);

create policy "Service role can update clothing"
  on public.clothing_items for update
  to service_role
  using (true);

create policy "Service role can insert events"
  on public.events for insert
  to service_role
  with check (true);

create policy "Service role can insert outfit suggestions"
  on public.outfit_suggestions for insert
  to service_role
  with check (true);

create policy "Service role can update outfit suggestions"
  on public.outfit_suggestions for update
  to service_role
  using (true);

-- pattern column on clothing_items (added after initial schema)
alter table public.clothing_items
  add column if not exists pattern text;


-- ─────────────────────────────────────────────────────────────────────────────
-- v1.3 — User profile columns
-- ─────────────────────────────────────────────────────────────────────────────

-- Extended user profile fields
alter table public.users
  add column if not exists body_type        text,
  add column if not exists height           float,
  add column if not exists weight           float,
  add column if not exists complexion       text,
  add column if not exists face_shape       text,
  add column if not exists hairstyle        text,
  add column if not exists preferred_styles jsonb default '{}';

-- RLS: allow users to update their own profile
-- (may already exist from schema.sql — safe to skip if duplicate error)
do $$ begin
  create policy "Users can update own profile"
    on public.users for update
    using (auth.uid() = id);
exception when duplicate_object then null;
end $$;

-- RLS: allow service role to update users table
create policy "Service role can update users"
  on public.users for update
  to service_role
  using (true);

-- RLS: allow user to update users table
create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id);


-- ─────────────────────────────────────────────────────────────────────────────
-- Storage bucket
-- ─────────────────────────────────────────────────────────────────────────────
-- Run manually in Supabase dashboard → Storage if not already done:
--
-- 1. Create bucket named exactly: clothing-images
--    Set public = false (private bucket)
--    Or run: update storage.buckets set public = false where name = 'clothing-images';
--
-- 2. Add upload policy in Storage → clothing-images → Policies:
--    CREATE POLICY "User uploads to own folder"
--    ON storage.objects FOR INSERT
--    WITH CHECK (
--      auth.uid()::text = (storage.foldername(name))[1]
--    );
--
-- 3. Add read policy:
--    CREATE POLICY "User reads own files"
--    ON storage.objects FOR SELECT
--    USING (
--      auth.uid()::text = (storage.foldername(name))[1]
--    );

-- Add  photo_url to users and create a bucket to store them
alter table public.users
  add column if not exists photo_url text;

-- Create bucket: profile-photos (private)
-- Storage → New bucket → name: profile-photos, public: false
-- Add upload policy: auth.uid()::text = (storage.foldername(name))[1]
-- Add read policy:   auth.uid()::text = (storage.foldername(name))[1]

-- Create bucket: profile-photos (public: true)
update storage.buckets set public = true where name = 'profile-photos';

-- Restrict uploads to owner's folder only (prevents writing to other users' paths)
-- Storage → profile-photos → Policies → New policy:
-- INSERT: auth.uid()::text = (storage.foldername(name))[1]
-- UPDATE: auth.uid()::text = (storage.foldername(name))[1]
-- DELETE: auth.uid()::text = (storage.foldername(name))[1]
-- SELECT: no restriction needed (bucket is public)

-- Allow authenticated users to upload to their own folder only
create policy "Users can upload own profile photo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow authenticated users to update their own photo (upsert)
create policy "Users can update own profile photo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow authenticated users to delete their own photo
create policy "Users can delete own profile photo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

--   Update the column name to clarify metric of column
alter table public.users rename column height to height_cm;
alter table public.users rename column weight to weight_kg;

create policy "Users can upload own profile photo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Service role can upload profile photos"
  on storage.objects for insert to service_role
  with check (true);

create policy "Service role can update profile photos"
  on storage.objects for update to service_role
  using (bucket_id = 'profile-photos');

alter table public.clothing_items
  add column if not exists descriptors jsonb default '{}';

-- Audit and soft-delete columns for clothing_items
alter table public.clothing_items
  add column if not exists updated_at   timestamptz default now(),
  add column if not exists deleted_at   timestamptz default null,
  add column if not exists is_active    boolean     default true;

-- Auto-update updated_at on any row change
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clothing_items_updated_at on public.clothing_items;
create trigger clothing_items_updated_at
  before update on public.clothing_items
  for each row execute procedure public.set_updated_at();

-- Soft delete: filter inactive items from all queries
-- Note: update get_user_items() to filter is_active = true

-- 1. Event semantic tokens (for occasion-scoped feedback)
ALTER TABLE events ADD COLUMN event_tokens jsonb DEFAULT '[]';

-- 2. Ensure updated_at fires on rating updates (for temporal decay later)
-- (only if the existing trigger doesn't already cover outfit_suggestions)
