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

-- thumbnail URL for fast wardrobe/event/archive grids
alter table public.clothing_items
  add column if not exists thumbnail_url text;


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
  add column if not exists photo_url text,
  add column if not exists ai_profile_photo_url text,
  add column if not exists ai_profile_analysis jsonb default '{}',
  add column if not exists ai_profile_analyzed_at timestamptz;

-- Create bucket: profile-photos (private)
-- Storage → New bucket → name: profile-photos, public: false
-- Add upload policy: auth.uid()::text = (storage.foldername(name))[1]
-- Add read policy:   auth.uid()::text = (storage.foldername(name))[1]

-- Create bucket: profile-photos (public: true)
update storage.buckets set public = true where name = 'profile-photos';
update storage.buckets set public = true where name = 'ai-profile-photos';

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

create policy "Users can upload own AI profile photo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'ai-profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update own AI profile photo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'ai-profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own AI profile photo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'ai-profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Service role can upload AI profile photos"
  on storage.objects for insert to service_role
  with check (bucket_id = 'ai-profile-photos');

create policy "Service role can update AI profile photos"
  on storage.objects for update to service_role
  using (bucket_id = 'ai-profile-photos');

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


-- ─────────────────────────────────────────────────────────────────────────────
-- v1.8.0 — 90-day auto-purge for soft-deleted wardrobe items
-- ─────────────────────────────────────────────────────────────────────────────
-- Items are soft-deleted (is_active=FALSE, deleted_at=<timestamp>).
-- After 90 days they should be hard-deleted (DB row + storage file).
--
-- TWO options — choose one:
--
-- ── Option A: pg_cron (Supabase-native, DB rows only) ──────────────────────
-- Requires pg_cron extension. Enable via:
--   Supabase Dashboard → Database → Extensions → pg_cron (toggle ON)
-- Then run the block below ONCE in the SQL Editor:
--
-- select cron.schedule(
--   'luxelook-purge-deleted-wardrobe-items',  -- job name (unique)
--   '0 3 * * *',                               -- daily at 03:00 UTC
--   $$
--     delete from public.clothing_items
--     where is_active = false
--       and deleted_at < now() - interval '90 days';
--   $$
-- );
--
-- NOTE: pg_cron purges DB rows only. Storage files are NOT cleaned up this way.
-- Storage cleanup happens automatically when POST /clothing/purge-deleted is called.
--
-- ── Option B: external cron → POST /clothing/purge-deleted (recommended) ───
-- Call the backend endpoint on a schedule using any external cron service:
--   EasyCron:  https://www.easycron.com
--   Railway:   cron jobs in Railway project settings
--   Render:    cron job service
--
-- Endpoint:  POST https://<your-backend>/clothing/purge-deleted
-- Auth:      Authorization: Bearer <any valid user JWT>
-- Effect:    Deletes rows AND storage files older than 90 days for that user
--
-- To purge ALL users (admin-level), implement a service-role variant separately.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- v1.9.0 — style_taxonomy table + performance indexes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.style_taxonomy (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    domain      text NOT NULL,
    category    text NOT NULL DEFAULT '',
    attribute   text NOT NULL,
    value       text NOT NULL,
    meta        jsonb DEFAULT '{}',
    sort_order  int  DEFAULT 0,
    is_active   boolean DEFAULT true,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now(),
    UNIQUE (domain, category, attribute, value)
);

CREATE INDEX IF NOT EXISTS idx_style_taxonomy_domain
    ON public.style_taxonomy (domain);

CREATE INDEX IF NOT EXISTS idx_style_taxonomy_domain_cat
    ON public.style_taxonomy (domain, category);

DROP TRIGGER IF EXISTS style_taxonomy_updated_at ON public.style_taxonomy;
CREATE TRIGGER style_taxonomy_updated_at
    BEFORE UPDATE ON public.style_taxonomy
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- v1.8.0 — soft-delete performance indexes
CREATE INDEX IF NOT EXISTS idx_clothing_items_user_active
    ON public.clothing_items (user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_clothing_items_trash
    ON public.clothing_items (user_id, deleted_at)
    WHERE is_active = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- v1.9.0 — style_taxonomy seed data  (660 rows, 5 domains)
--
-- NULL-safe: rows without a clothing category use '' (empty string) so the
-- UNIQUE(domain, category, attribute, value) constraint resolves correctly.
-- ON CONFLICT DO NOTHING makes every INSERT block idempotent (safe to re-run).
--
-- Verify after run:
--   SELECT domain, COUNT(*) FROM public.style_taxonomy GROUP BY domain ORDER BY domain;
-- ─────────────────────────────────────────────────────────────────────────────

-- Descriptor vocabulary — CATEGORY_DESCRIPTORS in ml/llm.py
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  ('descriptor', 'tops', 'fabric_type', 'cotton', '{}', 1),
  ('descriptor', 'tops', 'fabric_type', 'polyester', '{}', 2),
  ('descriptor', 'tops', 'fabric_type', 'nylon', '{}', 3),
  ('descriptor', 'tops', 'fabric_type', 'spandex', '{}', 4),
  ('descriptor', 'tops', 'fabric_type', 'rayon', '{}', 5),
  ('descriptor', 'tops', 'fabric_type', 'linen', '{}', 6),
  ('descriptor', 'tops', 'fabric_type', 'denim', '{}', 7),
  ('descriptor', 'tops', 'fabric_type', 'satin', '{}', 8),
  ('descriptor', 'tops', 'fabric_type', 'silk', '{}', 9),
  ('descriptor', 'tops', 'fabric_type', 'chiffon', '{}', 10),
  ('descriptor', 'tops', 'fabric_type', 'mesh', '{}', 11),
  ('descriptor', 'tops', 'fabric_type', 'lace', '{}', 12),
  ('descriptor', 'tops', 'fabric_type', 'knit', '{}', 13),
  ('descriptor', 'tops', 'fabric_type', 'wool', '{}', 14),
  ('descriptor', 'tops', 'neckline', 'crew', '{}', 1),
  ('descriptor', 'tops', 'neckline', 'round', '{}', 2),
  ('descriptor', 'tops', 'neckline', 'V-neck', '{}', 3),
  ('descriptor', 'tops', 'neckline', 'square', '{}', 4),
  ('descriptor', 'tops', 'neckline', 'scoop', '{}', 5),
  ('descriptor', 'tops', 'neckline', 'sweetheart', '{}', 6),
  ('descriptor', 'tops', 'neckline', 'off-shoulder', '{}', 7),
  ('descriptor', 'tops', 'neckline', 'halter', '{}', 8),
  ('descriptor', 'tops', 'neckline', 'high neck', '{}', 9),
  ('descriptor', 'tops', 'neckline', 'turtleneck', '{}', 10),
  ('descriptor', 'tops', 'neckline', 'collar', '{}', 11),
  ('descriptor', 'tops', 'neckline', 'cowl', '{}', 12),
  ('descriptor', 'tops', 'neckline', 'asymmetrical', '{}', 13),
  ('descriptor', 'tops', 'sleeve_length', 'sleeveless', '{}', 1),
  ('descriptor', 'tops', 'sleeve_length', 'cap', '{}', 2),
  ('descriptor', 'tops', 'sleeve_length', 'short', '{}', 3),
  ('descriptor', 'tops', 'sleeve_length', '3/4', '{}', 4),
  ('descriptor', 'tops', 'sleeve_length', 'long', '{}', 5),
  ('descriptor', 'tops', 'sleeve_style', 'puff', '{}', 1),
  ('descriptor', 'tops', 'sleeve_style', 'bishop', '{}', 2),
  ('descriptor', 'tops', 'sleeve_style', 'balloon', '{}', 3),
  ('descriptor', 'tops', 'sleeve_style', 'bell', '{}', 4),
  ('descriptor', 'tops', 'sleeve_style', 'raglan', '{}', 5),
  ('descriptor', 'tops', 'sleeve_style', 'batwing', '{}', 6),
  ('descriptor', 'tops', 'sleeve_style', 'cold shoulder', '{}', 7),
  ('descriptor', 'tops', 'sleeve_style', 'flutter', '{}', 8),
  ('descriptor', 'tops', 'fit', 'slim', '{}', 1),
  ('descriptor', 'tops', 'fit', 'regular', '{}', 2),
  ('descriptor', 'tops', 'fit', 'relaxed', '{}', 3),
  ('descriptor', 'tops', 'fit', 'loose', '{}', 4),
  ('descriptor', 'tops', 'fit', 'oversized', '{}', 5),
  ('descriptor', 'tops', 'fit', 'bodycon', '{}', 6),
  ('descriptor', 'tops', 'fit', 'tailored', '{}', 7),
  ('descriptor', 'tops', 'fit', 'A-line', '{}', 8),
  ('descriptor', 'tops', 'fit', 'fit & flare', '{}', 9),
  ('descriptor', 'tops', 'fit', 'wrap', '{}', 10),
  ('descriptor', 'tops', 'length', 'crop', '{}', 1),
  ('descriptor', 'tops', 'length', 'regular', '{}', 2),
  ('descriptor', 'tops', 'length', 'longline', '{}', 3),
  ('descriptor', 'tops', 'closure', 'pullover', '{}', 1),
  ('descriptor', 'tops', 'closure', 'button-front', '{}', 2),
  ('descriptor', 'tops', 'closure', 'zip-up', '{}', 3),
  ('descriptor', 'tops', 'closure', 'wrap', '{}', 4),
  ('descriptor', 'tops', 'closure', 'open front', '{}', 5),
  ('descriptor', 'tops', 'hemline', 'straight', '{}', 1),
  ('descriptor', 'tops', 'hemline', 'curved', '{}', 2),
  ('descriptor', 'tops', 'hemline', 'asymmetrical', '{}', 3),
  ('descriptor', 'tops', 'hemline', 'high-low', '{}', 4),
  ('descriptor', 'tops', 'hemline', 'peplum', '{}', 5),
  ('descriptor', 'tops', 'hemline', 'ruffle hem', '{}', 6),
  ('descriptor', 'tops', 'strap_type', 'strapless', '{}', 1),
  ('descriptor', 'tops', 'strap_type', 'spaghetti', '{}', 2),
  ('descriptor', 'tops', 'strap_type', 'wide', '{}', 3),
  ('descriptor', 'tops', 'strap_type', 'adjustable', '{}', 4),
  ('descriptor', 'tops', 'strap_type', 'racerback', '{}', 5),
  ('descriptor', 'tops', 'strap_type', 'cross-back', '{}', 6),
  ('descriptor', 'tops', 'strap_type', 'halter', '{}', 7),
  ('descriptor', 'tops', 'back_style', 'open back', '{}', 1),
  ('descriptor', 'tops', 'back_style', 'low back', '{}', 2),
  ('descriptor', 'tops', 'back_style', 'keyhole', '{}', 3),
  ('descriptor', 'tops', 'back_style', 'strappy', '{}', 4),
  ('descriptor', 'tops', 'back_style', 'tie-back', '{}', 5),
  ('descriptor', 'tops', 'back_style', 'zipper back', '{}', 6),
  ('descriptor', 'tops', 'detailing', 'ruffles', '{}', 1),
  ('descriptor', 'tops', 'detailing', 'pleats', '{}', 2),
  ('descriptor', 'tops', 'detailing', 'ruched', '{}', 3),
  ('descriptor', 'tops', 'detailing', 'smocked', '{}', 4),
  ('descriptor', 'tops', 'detailing', 'tiered', '{}', 5),
  ('descriptor', 'tops', 'detailing', 'draped', '{}', 6),
  ('descriptor', 'tops', 'detailing', 'cut-out', '{}', 7),
  ('descriptor', 'tops', 'detailing', 'slit', '{}', 8),
  ('descriptor', 'tops', 'detailing', 'bow', '{}', 9),
  ('descriptor', 'tops', 'detailing', 'knot', '{}', 10),
  ('descriptor', 'tops', 'detailing', 'lace-up', '{}', 11),
  ('descriptor', 'tops', 'detailing', 'fringe', '{}', 12),
  ('descriptor', 'tops', 'detailing', 'embroidery', '{}', 13),
  ('descriptor', 'tops', 'elasticity', 'non-stretch', '{}', 1),
  ('descriptor', 'tops', 'elasticity', 'slight stretch', '{}', 2),
  ('descriptor', 'tops', 'elasticity', 'medium stretch', '{}', 3),
  ('descriptor', 'tops', 'elasticity', 'high stretch', '{}', 4),
  ('descriptor', 'tops', 'sheer', 'opaque', '{}', 1),
  ('descriptor', 'tops', 'sheer', 'semi-sheer', '{}', 2),
  ('descriptor', 'tops', 'sheer', 'sheer', '{}', 3),
  ('descriptor', 'tops', 'pattern', 'solid', '{}', 1),
  ('descriptor', 'tops', 'pattern', 'floral', '{}', 2),
  ('descriptor', 'tops', 'pattern', 'striped', '{}', 3),
  ('descriptor', 'tops', 'pattern', 'graphic', '{}', 4),
  ('descriptor', 'tops', 'pattern', 'abstract', '{}', 5),
  ('descriptor', 'tops', 'pattern', 'tie-dye', '{}', 6),
  ('descriptor', 'tops', 'pattern', 'plaid', '{}', 7),
  ('descriptor', 'tops', 'pattern', 'animal print', '{}', 8),
  ('descriptor', 'dresses', 'fabric_type', 'cotton', '{}', 1),
  ('descriptor', 'dresses', 'fabric_type', 'polyester', '{}', 2),
  ('descriptor', 'dresses', 'fabric_type', 'nylon', '{}', 3),
  ('descriptor', 'dresses', 'fabric_type', 'spandex', '{}', 4),
  ('descriptor', 'dresses', 'fabric_type', 'rayon', '{}', 5),
  ('descriptor', 'dresses', 'fabric_type', 'linen', '{}', 6),
  ('descriptor', 'dresses', 'fabric_type', 'denim', '{}', 7),
  ('descriptor', 'dresses', 'fabric_type', 'satin', '{}', 8),
  ('descriptor', 'dresses', 'fabric_type', 'silk', '{}', 9),
  ('descriptor', 'dresses', 'fabric_type', 'chiffon', '{}', 10),
  ('descriptor', 'dresses', 'fabric_type', 'mesh', '{}', 11),
  ('descriptor', 'dresses', 'fabric_type', 'lace', '{}', 12),
  ('descriptor', 'dresses', 'fabric_type', 'knit', '{}', 13),
  ('descriptor', 'dresses', 'fabric_type', 'wool', '{}', 14),
  ('descriptor', 'dresses', 'neckline', 'crew', '{}', 1),
  ('descriptor', 'dresses', 'neckline', 'round', '{}', 2),
  ('descriptor', 'dresses', 'neckline', 'V-neck', '{}', 3),
  ('descriptor', 'dresses', 'neckline', 'square', '{}', 4),
  ('descriptor', 'dresses', 'neckline', 'scoop', '{}', 5),
  ('descriptor', 'dresses', 'neckline', 'sweetheart', '{}', 6),
  ('descriptor', 'dresses', 'neckline', 'off-shoulder', '{}', 7),
  ('descriptor', 'dresses', 'neckline', 'halter', '{}', 8),
  ('descriptor', 'dresses', 'neckline', 'high neck', '{}', 9),
  ('descriptor', 'dresses', 'neckline', 'turtleneck', '{}', 10),
  ('descriptor', 'dresses', 'neckline', 'collar', '{}', 11),
  ('descriptor', 'dresses', 'neckline', 'cowl', '{}', 12),
  ('descriptor', 'dresses', 'neckline', 'asymmetrical', '{}', 13),
  ('descriptor', 'dresses', 'sleeve_length', 'sleeveless', '{}', 1),
  ('descriptor', 'dresses', 'sleeve_length', 'cap', '{}', 2),
  ('descriptor', 'dresses', 'sleeve_length', 'short', '{}', 3),
  ('descriptor', 'dresses', 'sleeve_length', '3/4', '{}', 4),
  ('descriptor', 'dresses', 'sleeve_length', 'long', '{}', 5),
  ('descriptor', 'dresses', 'sleeve_style', 'puff', '{}', 1),
  ('descriptor', 'dresses', 'sleeve_style', 'bishop', '{}', 2),
  ('descriptor', 'dresses', 'sleeve_style', 'balloon', '{}', 3),
  ('descriptor', 'dresses', 'sleeve_style', 'bell', '{}', 4),
  ('descriptor', 'dresses', 'sleeve_style', 'raglan', '{}', 5),
  ('descriptor', 'dresses', 'sleeve_style', 'batwing', '{}', 6),
  ('descriptor', 'dresses', 'sleeve_style', 'cold shoulder', '{}', 7),
  ('descriptor', 'dresses', 'sleeve_style', 'flutter', '{}', 8),
  ('descriptor', 'dresses', 'fit', 'slim', '{}', 1),
  ('descriptor', 'dresses', 'fit', 'regular', '{}', 2),
  ('descriptor', 'dresses', 'fit', 'relaxed', '{}', 3),
  ('descriptor', 'dresses', 'fit', 'loose', '{}', 4),
  ('descriptor', 'dresses', 'fit', 'oversized', '{}', 5),
  ('descriptor', 'dresses', 'fit', 'bodycon', '{}', 6),
  ('descriptor', 'dresses', 'fit', 'tailored', '{}', 7),
  ('descriptor', 'dresses', 'fit', 'A-line', '{}', 8),
  ('descriptor', 'dresses', 'fit', 'fit & flare', '{}', 9),
  ('descriptor', 'dresses', 'fit', 'wrap', '{}', 10),
  ('descriptor', 'dresses', 'length', 'crop', '{}', 1),
  ('descriptor', 'dresses', 'length', 'regular', '{}', 2),
  ('descriptor', 'dresses', 'length', 'longline', '{}', 3),
  ('descriptor', 'dresses', 'length', 'mini', '{}', 4),
  ('descriptor', 'dresses', 'length', 'midi', '{}', 5),
  ('descriptor', 'dresses', 'length', 'maxi', '{}', 6),
  ('descriptor', 'dresses', 'closure', 'pullover', '{}', 1),
  ('descriptor', 'dresses', 'closure', 'button-front', '{}', 2),
  ('descriptor', 'dresses', 'closure', 'zip-up', '{}', 3),
  ('descriptor', 'dresses', 'closure', 'wrap', '{}', 4),
  ('descriptor', 'dresses', 'closure', 'open front', '{}', 5),
  ('descriptor', 'dresses', 'hemline', 'straight', '{}', 1),
  ('descriptor', 'dresses', 'hemline', 'curved', '{}', 2),
  ('descriptor', 'dresses', 'hemline', 'asymmetrical', '{}', 3),
  ('descriptor', 'dresses', 'hemline', 'high-low', '{}', 4),
  ('descriptor', 'dresses', 'hemline', 'peplum', '{}', 5),
  ('descriptor', 'dresses', 'hemline', 'ruffle hem', '{}', 6),
  ('descriptor', 'dresses', 'strap_type', 'strapless', '{}', 1),
  ('descriptor', 'dresses', 'strap_type', 'spaghetti', '{}', 2),
  ('descriptor', 'dresses', 'strap_type', 'wide', '{}', 3),
  ('descriptor', 'dresses', 'strap_type', 'adjustable', '{}', 4),
  ('descriptor', 'dresses', 'strap_type', 'racerback', '{}', 5),
  ('descriptor', 'dresses', 'strap_type', 'cross-back', '{}', 6),
  ('descriptor', 'dresses', 'strap_type', 'halter', '{}', 7),
  ('descriptor', 'dresses', 'back_style', 'open back', '{}', 1),
  ('descriptor', 'dresses', 'back_style', 'low back', '{}', 2),
  ('descriptor', 'dresses', 'back_style', 'keyhole', '{}', 3),
  ('descriptor', 'dresses', 'back_style', 'strappy', '{}', 4),
  ('descriptor', 'dresses', 'back_style', 'tie-back', '{}', 5),
  ('descriptor', 'dresses', 'back_style', 'zipper back', '{}', 6),
  ('descriptor', 'dresses', 'detailing', 'ruffles', '{}', 1),
  ('descriptor', 'dresses', 'detailing', 'pleats', '{}', 2),
  ('descriptor', 'dresses', 'detailing', 'ruched', '{}', 3),
  ('descriptor', 'dresses', 'detailing', 'smocked', '{}', 4),
  ('descriptor', 'dresses', 'detailing', 'tiered', '{}', 5),
  ('descriptor', 'dresses', 'detailing', 'draped', '{}', 6),
  ('descriptor', 'dresses', 'detailing', 'cut-out', '{}', 7),
  ('descriptor', 'dresses', 'detailing', 'slit', '{}', 8),
  ('descriptor', 'dresses', 'detailing', 'bow', '{}', 9),
  ('descriptor', 'dresses', 'detailing', 'knot', '{}', 10),
  ('descriptor', 'dresses', 'detailing', 'lace-up', '{}', 11),
  ('descriptor', 'dresses', 'detailing', 'fringe', '{}', 12),
  ('descriptor', 'dresses', 'detailing', 'embroidery', '{}', 13),
  ('descriptor', 'dresses', 'elasticity', 'non-stretch', '{}', 1),
  ('descriptor', 'dresses', 'elasticity', 'slight stretch', '{}', 2),
  ('descriptor', 'dresses', 'elasticity', 'medium stretch', '{}', 3),
  ('descriptor', 'dresses', 'elasticity', 'high stretch', '{}', 4),
  ('descriptor', 'dresses', 'sheer', 'opaque', '{}', 1),
  ('descriptor', 'dresses', 'sheer', 'semi-sheer', '{}', 2),
  ('descriptor', 'dresses', 'sheer', 'sheer', '{}', 3),
  ('descriptor', 'dresses', 'pattern', 'solid', '{}', 1),
  ('descriptor', 'dresses', 'pattern', 'floral', '{}', 2),
  ('descriptor', 'dresses', 'pattern', 'striped', '{}', 3),
  ('descriptor', 'dresses', 'pattern', 'graphic', '{}', 4),
  ('descriptor', 'dresses', 'pattern', 'abstract', '{}', 5),
  ('descriptor', 'dresses', 'pattern', 'tie-dye', '{}', 6),
  ('descriptor', 'dresses', 'pattern', 'plaid', '{}', 7),
  ('descriptor', 'dresses', 'pattern', 'animal print', '{}', 8),
  ('descriptor', 'outerwear', 'fabric_type', 'cotton', '{}', 1),
  ('descriptor', 'outerwear', 'fabric_type', 'polyester', '{}', 2),
  ('descriptor', 'outerwear', 'fabric_type', 'nylon', '{}', 3),
  ('descriptor', 'outerwear', 'fabric_type', 'spandex', '{}', 4),
  ('descriptor', 'outerwear', 'fabric_type', 'rayon', '{}', 5),
  ('descriptor', 'outerwear', 'fabric_type', 'linen', '{}', 6),
  ('descriptor', 'outerwear', 'fabric_type', 'denim', '{}', 7),
  ('descriptor', 'outerwear', 'fabric_type', 'satin', '{}', 8),
  ('descriptor', 'outerwear', 'fabric_type', 'silk', '{}', 9),
  ('descriptor', 'outerwear', 'fabric_type', 'chiffon', '{}', 10),
  ('descriptor', 'outerwear', 'fabric_type', 'mesh', '{}', 11),
  ('descriptor', 'outerwear', 'fabric_type', 'lace', '{}', 12),
  ('descriptor', 'outerwear', 'fabric_type', 'knit', '{}', 13),
  ('descriptor', 'outerwear', 'fabric_type', 'wool', '{}', 14),
  ('descriptor', 'outerwear', 'neckline', 'crew', '{}', 1),
  ('descriptor', 'outerwear', 'neckline', 'round', '{}', 2),
  ('descriptor', 'outerwear', 'neckline', 'V-neck', '{}', 3),
  ('descriptor', 'outerwear', 'neckline', 'square', '{}', 4),
  ('descriptor', 'outerwear', 'neckline', 'scoop', '{}', 5),
  ('descriptor', 'outerwear', 'neckline', 'sweetheart', '{}', 6),
  ('descriptor', 'outerwear', 'neckline', 'off-shoulder', '{}', 7),
  ('descriptor', 'outerwear', 'neckline', 'halter', '{}', 8),
  ('descriptor', 'outerwear', 'neckline', 'high neck', '{}', 9),
  ('descriptor', 'outerwear', 'neckline', 'turtleneck', '{}', 10),
  ('descriptor', 'outerwear', 'neckline', 'collar', '{}', 11),
  ('descriptor', 'outerwear', 'neckline', 'cowl', '{}', 12),
  ('descriptor', 'outerwear', 'neckline', 'asymmetrical', '{}', 13),
  ('descriptor', 'outerwear', 'sleeve_length', 'sleeveless', '{}', 1),
  ('descriptor', 'outerwear', 'sleeve_length', 'cap', '{}', 2),
  ('descriptor', 'outerwear', 'sleeve_length', 'short', '{}', 3),
  ('descriptor', 'outerwear', 'sleeve_length', '3/4', '{}', 4),
  ('descriptor', 'outerwear', 'sleeve_length', 'long', '{}', 5),
  ('descriptor', 'outerwear', 'sleeve_style', 'puff', '{}', 1),
  ('descriptor', 'outerwear', 'sleeve_style', 'bishop', '{}', 2),
  ('descriptor', 'outerwear', 'sleeve_style', 'balloon', '{}', 3),
  ('descriptor', 'outerwear', 'sleeve_style', 'bell', '{}', 4),
  ('descriptor', 'outerwear', 'sleeve_style', 'raglan', '{}', 5),
  ('descriptor', 'outerwear', 'sleeve_style', 'batwing', '{}', 6),
  ('descriptor', 'outerwear', 'sleeve_style', 'cold shoulder', '{}', 7),
  ('descriptor', 'outerwear', 'sleeve_style', 'flutter', '{}', 8),
  ('descriptor', 'outerwear', 'fit', 'slim', '{}', 1),
  ('descriptor', 'outerwear', 'fit', 'regular', '{}', 2),
  ('descriptor', 'outerwear', 'fit', 'relaxed', '{}', 3),
  ('descriptor', 'outerwear', 'fit', 'loose', '{}', 4),
  ('descriptor', 'outerwear', 'fit', 'oversized', '{}', 5),
  ('descriptor', 'outerwear', 'fit', 'bodycon', '{}', 6),
  ('descriptor', 'outerwear', 'fit', 'tailored', '{}', 7),
  ('descriptor', 'outerwear', 'fit', 'A-line', '{}', 8),
  ('descriptor', 'outerwear', 'fit', 'fit & flare', '{}', 9),
  ('descriptor', 'outerwear', 'fit', 'wrap', '{}', 10),
  ('descriptor', 'outerwear', 'length', 'crop', '{}', 1),
  ('descriptor', 'outerwear', 'length', 'regular', '{}', 2),
  ('descriptor', 'outerwear', 'length', 'longline', '{}', 3),
  ('descriptor', 'outerwear', 'closure', 'pullover', '{}', 1),
  ('descriptor', 'outerwear', 'closure', 'button-front', '{}', 2),
  ('descriptor', 'outerwear', 'closure', 'zip-up', '{}', 3),
  ('descriptor', 'outerwear', 'closure', 'wrap', '{}', 4),
  ('descriptor', 'outerwear', 'closure', 'open front', '{}', 5),
  ('descriptor', 'outerwear', 'hemline', 'straight', '{}', 1),
  ('descriptor', 'outerwear', 'hemline', 'curved', '{}', 2),
  ('descriptor', 'outerwear', 'hemline', 'asymmetrical', '{}', 3),
  ('descriptor', 'outerwear', 'hemline', 'high-low', '{}', 4),
  ('descriptor', 'outerwear', 'hemline', 'peplum', '{}', 5),
  ('descriptor', 'outerwear', 'hemline', 'ruffle hem', '{}', 6),
  ('descriptor', 'outerwear', 'back_style', 'open back', '{}', 1),
  ('descriptor', 'outerwear', 'back_style', 'low back', '{}', 2),
  ('descriptor', 'outerwear', 'back_style', 'keyhole', '{}', 3),
  ('descriptor', 'outerwear', 'back_style', 'strappy', '{}', 4),
  ('descriptor', 'outerwear', 'back_style', 'tie-back', '{}', 5),
  ('descriptor', 'outerwear', 'back_style', 'zipper back', '{}', 6),
  ('descriptor', 'outerwear', 'detailing', 'ruffles', '{}', 1),
  ('descriptor', 'outerwear', 'detailing', 'pleats', '{}', 2),
  ('descriptor', 'outerwear', 'detailing', 'ruched', '{}', 3),
  ('descriptor', 'outerwear', 'detailing', 'smocked', '{}', 4),
  ('descriptor', 'outerwear', 'detailing', 'tiered', '{}', 5),
  ('descriptor', 'outerwear', 'detailing', 'draped', '{}', 6),
  ('descriptor', 'outerwear', 'detailing', 'cut-out', '{}', 7),
  ('descriptor', 'outerwear', 'detailing', 'slit', '{}', 8),
  ('descriptor', 'outerwear', 'detailing', 'bow', '{}', 9),
  ('descriptor', 'outerwear', 'detailing', 'knot', '{}', 10),
  ('descriptor', 'outerwear', 'detailing', 'lace-up', '{}', 11),
  ('descriptor', 'outerwear', 'detailing', 'fringe', '{}', 12),
  ('descriptor', 'outerwear', 'detailing', 'embroidery', '{}', 13),
  ('descriptor', 'outerwear', 'elasticity', 'non-stretch', '{}', 1),
  ('descriptor', 'outerwear', 'elasticity', 'slight stretch', '{}', 2),
  ('descriptor', 'outerwear', 'elasticity', 'medium stretch', '{}', 3),
  ('descriptor', 'outerwear', 'elasticity', 'high stretch', '{}', 4),
  ('descriptor', 'outerwear', 'sheer', 'opaque', '{}', 1),
  ('descriptor', 'outerwear', 'sheer', 'semi-sheer', '{}', 2),
  ('descriptor', 'outerwear', 'sheer', 'sheer', '{}', 3),
  ('descriptor', 'outerwear', 'pattern', 'solid', '{}', 1),
  ('descriptor', 'outerwear', 'pattern', 'floral', '{}', 2),
  ('descriptor', 'outerwear', 'pattern', 'striped', '{}', 3),
  ('descriptor', 'outerwear', 'pattern', 'graphic', '{}', 4),
  ('descriptor', 'outerwear', 'pattern', 'abstract', '{}', 5),
  ('descriptor', 'outerwear', 'pattern', 'tie-dye', '{}', 6),
  ('descriptor', 'outerwear', 'pattern', 'plaid', '{}', 7),
  ('descriptor', 'outerwear', 'pattern', 'animal print', '{}', 8),
  ('descriptor', 'outerwear', 'insulation', 'lightweight', '{}', 1),
  ('descriptor', 'outerwear', 'insulation', 'midweight', '{}', 2),
  ('descriptor', 'outerwear', 'insulation', 'heavyweight', '{}', 3),
  ('descriptor', 'outerwear', 'insulation', 'insulated', '{}', 4),
  ('descriptor', 'outerwear', 'insulation', 'down-filled', '{}', 5),
  ('descriptor', 'outerwear', 'weather_resistance', 'water-resistant', '{}', 1),
  ('descriptor', 'outerwear', 'weather_resistance', 'waterproof', '{}', 2),
  ('descriptor', 'outerwear', 'weather_resistance', 'windproof', '{}', 3),
  ('descriptor', 'bottoms', 'fabric_type', 'denim', '{}', 1),
  ('descriptor', 'bottoms', 'fabric_type', 'cotton', '{}', 2),
  ('descriptor', 'bottoms', 'fabric_type', 'polyester', '{}', 3),
  ('descriptor', 'bottoms', 'fabric_type', 'linen', '{}', 4),
  ('descriptor', 'bottoms', 'fabric_type', 'knit', '{}', 5),
  ('descriptor', 'bottoms', 'fabric_type', 'leather', '{}', 6),
  ('descriptor', 'bottoms', 'waist_position', 'high', '{}', 1),
  ('descriptor', 'bottoms', 'waist_position', 'mid', '{}', 2),
  ('descriptor', 'bottoms', 'waist_position', 'low', '{}', 3),
  ('descriptor', 'bottoms', 'waist_position', 'drop', '{}', 4),
  ('descriptor', 'bottoms', 'waist_position', 'empire', '{}', 5),
  ('descriptor', 'bottoms', 'waist_structure', 'elastic', '{}', 1),
  ('descriptor', 'bottoms', 'waist_structure', 'drawstring', '{}', 2),
  ('descriptor', 'bottoms', 'waist_structure', 'belted', '{}', 3),
  ('descriptor', 'bottoms', 'waist_structure', 'paperbag', '{}', 4),
  ('descriptor', 'bottoms', 'waist_structure', 'corset', '{}', 5),
  ('descriptor', 'bottoms', 'fit', 'slim', '{}', 1),
  ('descriptor', 'bottoms', 'fit', 'straight', '{}', 2),
  ('descriptor', 'bottoms', 'fit', 'relaxed', '{}', 3),
  ('descriptor', 'bottoms', 'fit', 'loose', '{}', 4),
  ('descriptor', 'bottoms', 'fit', 'wide-leg', '{}', 5),
  ('descriptor', 'bottoms', 'fit', 'flared', '{}', 6),
  ('descriptor', 'bottoms', 'leg_opening', 'skinny', '{}', 1),
  ('descriptor', 'bottoms', 'leg_opening', 'straight', '{}', 2),
  ('descriptor', 'bottoms', 'leg_opening', 'wide', '{}', 3),
  ('descriptor', 'bottoms', 'leg_opening', 'flare', '{}', 4),
  ('descriptor', 'bottoms', 'leg_opening', 'bootcut', '{}', 5),
  ('descriptor', 'bottoms', 'leg_opening', 'tapered', '{}', 6),
  ('descriptor', 'bottoms', 'leg_opening', 'barrel', '{}', 7),
  ('descriptor', 'bottoms', 'length', 'shorts', '{}', 1),
  ('descriptor', 'bottoms', 'length', 'mini', '{}', 2),
  ('descriptor', 'bottoms', 'length', 'midi', '{}', 3),
  ('descriptor', 'bottoms', 'length', 'maxi', '{}', 4),
  ('descriptor', 'bottoms', 'length', 'capri', '{}', 5),
  ('descriptor', 'bottoms', 'length', 'ankle', '{}', 6),
  ('descriptor', 'bottoms', 'length', 'full-length', '{}', 7),
  ('descriptor', 'bottoms', 'distressing', 'clean', '{}', 1),
  ('descriptor', 'bottoms', 'distressing', 'distressed', '{}', 2),
  ('descriptor', 'bottoms', 'distressing', 'ripped', '{}', 3),
  ('descriptor', 'bottoms', 'distressing', 'frayed', '{}', 4),
  ('descriptor', 'bottoms', 'distressing', 'washed', '{}', 5),
  ('descriptor', 'bottoms', 'elasticity', 'non-stretch', '{}', 1),
  ('descriptor', 'bottoms', 'elasticity', 'slight stretch', '{}', 2),
  ('descriptor', 'bottoms', 'elasticity', 'medium stretch', '{}', 3),
  ('descriptor', 'bottoms', 'elasticity', 'high stretch', '{}', 4),
  ('descriptor', 'bottoms', 'sheer', 'opaque', '{}', 1),
  ('descriptor', 'bottoms', 'sheer', 'semi-sheer', '{}', 2),
  ('descriptor', 'bottoms', 'pattern', 'solid', '{}', 1),
  ('descriptor', 'bottoms', 'pattern', 'plaid', '{}', 2),
  ('descriptor', 'bottoms', 'pattern', 'striped', '{}', 3),
  ('descriptor', 'bottoms', 'pattern', 'floral', '{}', 4),
  ('descriptor', 'shoes', 'shoe_type', 'heels', '{}', 1),
  ('descriptor', 'shoes', 'shoe_type', 'sneakers', '{}', 2),
  ('descriptor', 'shoes', 'shoe_type', 'sandals', '{}', 3),
  ('descriptor', 'shoes', 'shoe_type', 'boots', '{}', 4),
  ('descriptor', 'shoes', 'shoe_type', 'flats', '{}', 5),
  ('descriptor', 'shoes', 'shoe_type', 'loafers', '{}', 6),
  ('descriptor', 'shoes', 'shoe_type', 'pumps', '{}', 7),
  ('descriptor', 'shoes', 'shoe_type', 'mules', '{}', 8),
  ('descriptor', 'shoes', 'shoe_type', 'platforms', '{}', 9),
  ('descriptor', 'shoes', 'shoe_type', 'mary janes', '{}', 10),
  ('descriptor', 'shoes', 'toe_shape', 'round', '{}', 1),
  ('descriptor', 'shoes', 'toe_shape', 'pointed', '{}', 2),
  ('descriptor', 'shoes', 'toe_shape', 'square', '{}', 3),
  ('descriptor', 'shoes', 'toe_shape', 'open-toe', '{}', 4),
  ('descriptor', 'shoes', 'toe_shape', 'peep-toe', '{}', 5),
  ('descriptor', 'shoes', 'heel_height', 'flat', '{}', 1),
  ('descriptor', 'shoes', 'heel_height', 'low', '{}', 2),
  ('descriptor', 'shoes', 'heel_height', 'mid', '{}', 3),
  ('descriptor', 'shoes', 'heel_height', 'high', '{}', 4),
  ('descriptor', 'shoes', 'heel_height', 'platform', '{}', 5),
  ('descriptor', 'shoes', 'heel_type', 'stiletto', '{}', 1),
  ('descriptor', 'shoes', 'heel_type', 'block', '{}', 2),
  ('descriptor', 'shoes', 'heel_type', 'wedge', '{}', 3),
  ('descriptor', 'shoes', 'heel_type', 'kitten', '{}', 4),
  ('descriptor', 'shoes', 'heel_type', 'cone', '{}', 5),
  ('descriptor', 'shoes', 'heel_type', 'spool', '{}', 6),
  ('descriptor', 'shoes', 'heel_type', 'chunky', '{}', 7),
  ('descriptor', 'shoes', 'heel_type', 'sculptural', '{}', 8),
  ('descriptor', 'shoes', 'closure', 'slip-on', '{}', 1),
  ('descriptor', 'shoes', 'closure', 'lace-up', '{}', 2),
  ('descriptor', 'shoes', 'closure', 'buckle', '{}', 3),
  ('descriptor', 'shoes', 'closure', 'zip', '{}', 4),
  ('descriptor', 'shoes', 'closure', 'velcro', '{}', 5),
  ('descriptor', 'shoes', 'closure', 'strappy', '{}', 6),
  ('descriptor', 'shoes', 'fit', 'regular', '{}', 1),
  ('descriptor', 'shoes', 'fit', 'wide', '{}', 2),
  ('descriptor', 'shoes', 'fit', 'narrow', '{}', 3),
  ('descriptor', 'shoes', 'material', 'leather', '{}', 1),
  ('descriptor', 'shoes', 'material', 'suede', '{}', 2),
  ('descriptor', 'shoes', 'material', 'canvas', '{}', 3),
  ('descriptor', 'shoes', 'material', 'synthetic', '{}', 4),
  ('descriptor', 'shoes', 'material', 'fabric', '{}', 5),
  ('descriptor', 'shoes', 'pattern', 'solid', '{}', 1),
  ('descriptor', 'shoes', 'pattern', 'animal print', '{}', 2),
  ('descriptor', 'shoes', 'pattern', 'textured', '{}', 3),
  ('descriptor', 'shoes', 'pattern', 'colorblock', '{}', 4),
  ('descriptor', 'accessories', 'accessory_type', 'handbag', '{}', 1),
  ('descriptor', 'accessories', 'accessory_type', 'tote', '{}', 2),
  ('descriptor', 'accessories', 'accessory_type', 'clutch', '{}', 3),
  ('descriptor', 'accessories', 'accessory_type', 'backpack', '{}', 4),
  ('descriptor', 'accessories', 'accessory_type', 'crossbody', '{}', 5),
  ('descriptor', 'accessories', 'accessory_type', 'belt', '{}', 6),
  ('descriptor', 'accessories', 'accessory_type', 'scarf', '{}', 7),
  ('descriptor', 'accessories', 'accessory_type', 'hat', '{}', 8),
  ('descriptor', 'accessories', 'accessory_type', 'sunglasses', '{}', 9),
  ('descriptor', 'accessories', 'accessory_type', 'jewelry', '{}', 10),
  ('descriptor', 'accessories', 'accessory_type', 'watch', '{}', 11),
  ('descriptor', 'accessories', 'size', 'mini', '{}', 1),
  ('descriptor', 'accessories', 'size', 'small', '{}', 2),
  ('descriptor', 'accessories', 'size', 'medium', '{}', 3),
  ('descriptor', 'accessories', 'size', 'large', '{}', 4),
  ('descriptor', 'accessories', 'size', 'oversized', '{}', 5),
  ('descriptor', 'accessories', 'material', 'leather', '{}', 1),
  ('descriptor', 'accessories', 'material', 'fabric', '{}', 2),
  ('descriptor', 'accessories', 'material', 'straw', '{}', 3),
  ('descriptor', 'accessories', 'material', 'metal', '{}', 4),
  ('descriptor', 'accessories', 'material', 'synthetic', '{}', 5),
  ('descriptor', 'accessories', 'style', 'structured', '{}', 1),
  ('descriptor', 'accessories', 'style', 'slouchy', '{}', 2),
  ('descriptor', 'accessories', 'style', 'minimalist', '{}', 3),
  ('descriptor', 'accessories', 'style', 'embellished', '{}', 4),
  ('descriptor', 'accessories', 'style', 'logo', '{}', 5),
  ('descriptor', 'accessories', 'closure', 'zipper', '{}', 1),
  ('descriptor', 'accessories', 'closure', 'magnetic', '{}', 2),
  ('descriptor', 'accessories', 'closure', 'snap', '{}', 3),
  ('descriptor', 'accessories', 'closure', 'drawstring', '{}', 4),
  ('descriptor', 'accessories', 'strap_type', 'top handle', '{}', 1),
  ('descriptor', 'accessories', 'strap_type', 'crossbody', '{}', 2),
  ('descriptor', 'accessories', 'strap_type', 'shoulder', '{}', 3),
  ('descriptor', 'accessories', 'strap_type', 'chain', '{}', 4)
ON CONFLICT DO NOTHING;

-- Color registry: name, RGB, CLIP prompt — COLOR_RGB + COLOR_LABELS
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  ('color', '', 'name', 'black', '{"r": 10, "g": 10, "b": 10, "clip_prompt": "this clothing item is black or very dark charcoal"}', 1),
  ('color', '', 'name', 'white', '{"r": 250, "g": 250, "b": 250, "clip_prompt": "this clothing item is white or off-white or cream coloured"}', 2),
  ('color', '', 'name', 'beige', '{"r": 245, "g": 225, "b": 200, "clip_prompt": "this clothing item is beige, tan, camel, or khaki coloured"}', 3),
  ('color', '', 'name', 'cream', '{"r": 255, "g": 253, "b": 240, "clip_prompt": ""}', 4),
  ('color', '', 'name', 'ivory', '{"r": 255, "g": 255, "b": 240, "clip_prompt": ""}', 5),
  ('color', '', 'name', 'grey', '{"r": 150, "g": 150, "b": 150, "clip_prompt": "this clothing item is grey or silver coloured"}', 6),
  ('color', '', 'name', 'gray', '{"r": 150, "g": 150, "b": 150, "clip_prompt": ""}', 7),
  ('color', '', 'name', 'charcoal', '{"r": 54, "g": 69, "b": 79, "clip_prompt": ""}', 8),
  ('color', '', 'name', 'silver', '{"r": 192, "g": 192, "b": 192, "clip_prompt": ""}', 9),
  ('color', '', 'name', 'navy', '{"r": 0, "g": 0, "b": 80, "clip_prompt": "this clothing item is navy blue or dark blue"}', 10),
  ('color', '', 'name', 'brown', '{"r": 101, "g": 67, "b": 33, "clip_prompt": "this clothing item is brown or chocolate or caramel coloured"}', 11),
  ('color', '', 'name', 'camel', '{"r": 193, "g": 154, "b": 107, "clip_prompt": ""}', 12),
  ('color', '', 'name', 'tan', '{"r": 210, "g": 180, "b": 140, "clip_prompt": ""}', 13),
  ('color', '', 'name', 'khaki', '{"r": 195, "g": 176, "b": 145, "clip_prompt": ""}', 14),
  ('color', '', 'name', 'red', '{"r": 220, "g": 20, "b": 20, "clip_prompt": "this clothing item is red or burgundy or wine coloured"}', 15),
  ('color', '', 'name', 'burgundy', '{"r": 128, "g": 0, "b": 32, "clip_prompt": ""}', 16),
  ('color', '', 'name', 'rust', '{"r": 183, "g": 65, "b": 14, "clip_prompt": ""}', 17),
  ('color', '', 'name', 'orange', '{"r": 230, "g": 120, "b": 30, "clip_prompt": "this clothing item is orange or rust or terracotta coloured"}', 18),
  ('color', '', 'name', 'coral', '{"r": 255, "g": 127, "b": 80, "clip_prompt": ""}', 19),
  ('color', '', 'name', 'yellow', '{"r": 255, "g": 220, "b": 40, "clip_prompt": "this clothing item is yellow or mustard or gold coloured"}', 20),
  ('color', '', 'name', 'mustard', '{"r": 210, "g": 170, "b": 50, "clip_prompt": ""}', 21),
  ('color', '', 'name', 'gold', '{"r": 212, "g": 175, "b": 55, "clip_prompt": ""}', 22),
  ('color', '', 'name', 'green', '{"r": 50, "g": 140, "b": 50, "clip_prompt": "this clothing item is green, olive, or forest green coloured"}', 23),
  ('color', '', 'name', 'olive', '{"r": 107, "g": 120, "b": 40, "clip_prompt": ""}', 24),
  ('color', '', 'name', 'sage', '{"r": 143, "g": 188, "b": 143, "clip_prompt": ""}', 25),
  ('color', '', 'name', 'mint', '{"r": 165, "g": 220, "b": 200, "clip_prompt": ""}', 26),
  ('color', '', 'name', 'teal', '{"r": 0, "g": 128, "b": 128, "clip_prompt": ""}', 27),
  ('color', '', 'name', 'blue', '{"r": 50, "g": 100, "b": 220, "clip_prompt": "this clothing item is blue or light blue or sky blue coloured"}', 28),
  ('color', '', 'name', 'cobalt', '{"r": 0, "g": 71, "b": 171, "clip_prompt": ""}', 29),
  ('color', '', 'name', 'purple', '{"r": 120, "g": 50, "b": 160, "clip_prompt": "this clothing item is purple, violet, or lavender coloured"}', 30),
  ('color', '', 'name', 'lavender', '{"r": 220, "g": 200, "b": 250, "clip_prompt": ""}', 31),
  ('color', '', 'name', 'pink', '{"r": 240, "g": 140, "b": 170, "clip_prompt": "this clothing item is pink, blush, or rose coloured"}', 32),
  ('color', '', 'name', 'blush', '{"r": 255, "g": 182, "b": 193, "clip_prompt": ""}', 33),
  ('color', '', 'name', 'magenta', '{"r": 255, "g": 0, "b": 255, "clip_prompt": ""}', 34)
ON CONFLICT DO NOTHING;

-- CLIP zero-shot classification labels — tagger.py
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  ('clip_label', '', 'category', 'tops', '{"clip_prompt": "a photo of a top, t-shirt, blouse, shirt, or sweater worn on the upper body"}', 1),
  ('clip_label', '', 'category', 'bottoms', '{"clip_prompt": "a photo of trousers, jeans, skirt, shorts, or pants worn on the lower body"}', 2),
  ('clip_label', '', 'category', 'dresses', '{"clip_prompt": "a photo of a dress or jumpsuit that covers both the torso and legs"}', 3),
  ('clip_label', '', 'category', 'shoes', '{"clip_prompt": "a photo of shoes, boots, heels, sneakers, sandals, or footwear"}', 4),
  ('clip_label', '', 'category', 'outerwear', '{"clip_prompt": "a photo of a coat, jacket, blazer, or cardigan worn as an outer layer"}', 5),
  ('clip_label', '', 'category', 'accessories', '{"clip_prompt": "a photo of an accessory such as a handbag, jewelry, belt, scarf, or hat"}', 6),
  ('clip_label', '', 'season', 'summer', '{"clip_prompt": "lightweight summer clothing \u2014 thin fabric, sleeveless, breathable, for hot weather"}', 1),
  ('clip_label', '', 'season', 'winter', '{"clip_prompt": "heavy winter clothing \u2014 thick fabric, warm, insulating, for cold weather"}', 2),
  ('clip_label', '', 'season', 'spring', '{"clip_prompt": "light layering piece for mild spring or autumn weather"}', 3),
  ('clip_label', '', 'season', 'fall', '{"clip_prompt": "medium weight clothing suitable for cool autumn or fall weather"}', 4),
  ('clip_label', '', 'season', 'all', '{"clip_prompt": "a versatile, all-season clothing item suitable for any time of year"}', 5),
  ('clip_label', '', 'accessory_type', 'bag', '{"clip_prompt": "a handbag, purse, tote bag, clutch, or backpack"}', 1),
  ('clip_label', '', 'accessory_type', 'jewelry', '{"clip_prompt": "jewelry such as a necklace, earrings, bracelet, ring, or watch"}', 2),
  ('clip_label', '', 'accessory_type', 'belt', '{"clip_prompt": "a belt worn around the waist"}', 3),
  ('clip_label', '', 'accessory_type', 'scarf', '{"clip_prompt": "a scarf, wrap, or shawl worn around the neck or shoulders"}', 4),
  ('clip_label', '', 'accessory_type', 'hat', '{"clip_prompt": "a hat, cap, or headwear"}', 5),
  ('clip_label', '', 'accessory_type', 'other', '{"clip_prompt": "another type of accessory or fashion item"}', 6)
ON CONFLICT DO NOTHING;

-- Body-type silhouette preferences — BODY_TYPE_PREFERENCES in recommender.py
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  ('body_type', 'hourglass', 'tops_fit', 'fitted', '{}', 1),
  ('body_type', 'hourglass', 'tops_fit', 'bodycon', '{}', 2),
  ('body_type', 'hourglass', 'tops_fit', 'wrap', '{}', 3),
  ('body_type', 'hourglass', 'tops_fit', 'tailored', '{}', 4),
  ('body_type', 'hourglass', 'tops_neckline', 'v-neck', '{}', 1),
  ('body_type', 'hourglass', 'tops_neckline', 'sweetheart', '{}', 2),
  ('body_type', 'hourglass', 'tops_neckline', 'plunging', '{}', 3),
  ('body_type', 'hourglass', 'tops_neckline', 'wrap', '{}', 4),
  ('body_type', 'hourglass', 'bottoms_fit', 'fitted', '{}', 1),
  ('body_type', 'hourglass', 'bottoms_fit', 'slim', '{}', 2),
  ('body_type', 'hourglass', 'bottoms_fit', 'skinny', '{}', 3),
  ('body_type', 'hourglass', 'bottoms_leg_opening', 'straight', '{}', 1),
  ('body_type', 'hourglass', 'bottoms_leg_opening', 'skinny', '{}', 2),
  ('body_type', 'hourglass', 'bottoms_leg_opening', 'flare', '{}', 3),
  ('body_type', 'hourglass', 'dresses_fit', 'fitted', '{}', 1),
  ('body_type', 'hourglass', 'dresses_fit', 'bodycon', '{}', 2),
  ('body_type', 'hourglass', 'dresses_fit', 'wrap', '{}', 3),
  ('body_type', 'hourglass', 'dresses_length', 'midi', '{}', 1),
  ('body_type', 'hourglass', 'dresses_length', 'knee', '{}', 2),
  ('body_type', 'hourglass', 'dresses_length', 'mini', '{}', 3),
  ('body_type', 'hourglass', 'outerwear_fit', 'fitted', '{}', 1),
  ('body_type', 'hourglass', 'outerwear_fit', 'tailored', '{}', 2),
  ('body_type', 'rectangle', 'tops_fit', 'oversized', '{}', 1),
  ('body_type', 'rectangle', 'tops_fit', 'relaxed', '{}', 2),
  ('body_type', 'rectangle', 'tops_fit', 'boxy', '{}', 3),
  ('body_type', 'rectangle', 'tops_fit', 'peplum', '{}', 4),
  ('body_type', 'rectangle', 'tops_neckline', 'scoop', '{}', 1),
  ('body_type', 'rectangle', 'tops_neckline', 'square', '{}', 2),
  ('body_type', 'rectangle', 'tops_neckline', 'off-shoulder', '{}', 3),
  ('body_type', 'rectangle', 'tops_neckline', 'sweetheart', '{}', 4),
  ('body_type', 'rectangle', 'bottoms_fit', 'wide', '{}', 1),
  ('body_type', 'rectangle', 'bottoms_fit', 'relaxed', '{}', 2),
  ('body_type', 'rectangle', 'bottoms_fit', 'high-waist', '{}', 3),
  ('body_type', 'rectangle', 'bottoms_leg_opening', 'wide', '{}', 1),
  ('body_type', 'rectangle', 'bottoms_leg_opening', 'flare', '{}', 2),
  ('body_type', 'rectangle', 'bottoms_leg_opening', 'bootcut', '{}', 3),
  ('body_type', 'rectangle', 'dresses_fit', 'a-line', '{}', 1),
  ('body_type', 'rectangle', 'dresses_fit', 'shift', '{}', 2),
  ('body_type', 'rectangle', 'dresses_fit', 'wrap', '{}', 3),
  ('body_type', 'rectangle', 'dresses_fit', 'peplum', '{}', 4),
  ('body_type', 'rectangle', 'dresses_length', 'midi', '{}', 1),
  ('body_type', 'rectangle', 'dresses_length', 'maxi', '{}', 2),
  ('body_type', 'rectangle', 'outerwear_fit', 'oversized', '{}', 1),
  ('body_type', 'rectangle', 'outerwear_fit', 'relaxed', '{}', 2),
  ('body_type', 'rectangle', 'outerwear_fit', 'belted', '{}', 3),
  ('body_type', 'pear', 'tops_fit', 'oversized', '{}', 1),
  ('body_type', 'pear', 'tops_fit', 'relaxed', '{}', 2),
  ('body_type', 'pear', 'tops_fit', 'structured', '{}', 3),
  ('body_type', 'pear', 'tops_fit', 'peplum', '{}', 4),
  ('body_type', 'pear', 'tops_neckline', 'boat', '{}', 1),
  ('body_type', 'pear', 'tops_neckline', 'off-shoulder', '{}', 2),
  ('body_type', 'pear', 'tops_neckline', 'square', '{}', 3),
  ('body_type', 'pear', 'tops_neckline', 'sweetheart', '{}', 4),
  ('body_type', 'pear', 'tops_neckline', 'scoop', '{}', 5),
  ('body_type', 'pear', 'bottoms_fit', 'a-line', '{}', 1),
  ('body_type', 'pear', 'bottoms_fit', 'relaxed', '{}', 2),
  ('body_type', 'pear', 'bottoms_leg_opening', 'flare', '{}', 1),
  ('body_type', 'pear', 'bottoms_leg_opening', 'wide', '{}', 2),
  ('body_type', 'pear', 'bottoms_leg_opening', 'bootcut', '{}', 3),
  ('body_type', 'pear', 'dresses_fit', 'a-line', '{}', 1),
  ('body_type', 'pear', 'dresses_fit', 'wrap', '{}', 2),
  ('body_type', 'pear', 'dresses_fit', 'empire', '{}', 3),
  ('body_type', 'pear', 'dresses_length', 'midi', '{}', 1),
  ('body_type', 'pear', 'dresses_length', 'knee', '{}', 2),
  ('body_type', 'pear', 'outerwear_fit', 'structured', '{}', 1),
  ('body_type', 'pear', 'outerwear_fit', 'tailored', '{}', 2),
  ('body_type', 'apple', 'tops_fit', 'relaxed', '{}', 1),
  ('body_type', 'apple', 'tops_fit', 'regular', '{}', 2),
  ('body_type', 'apple', 'tops_fit', 'empire', '{}', 3),
  ('body_type', 'apple', 'tops_neckline', 'v-neck', '{}', 1),
  ('body_type', 'apple', 'tops_neckline', 'plunging', '{}', 2),
  ('body_type', 'apple', 'tops_neckline', 'scoop', '{}', 3),
  ('body_type', 'apple', 'bottoms_fit', 'straight', '{}', 1),
  ('body_type', 'apple', 'bottoms_fit', 'regular', '{}', 2),
  ('body_type', 'apple', 'bottoms_leg_opening', 'straight', '{}', 1),
  ('body_type', 'apple', 'bottoms_leg_opening', 'wide', '{}', 2),
  ('body_type', 'apple', 'bottoms_leg_opening', 'bootcut', '{}', 3),
  ('body_type', 'apple', 'dresses_fit', 'empire', '{}', 1),
  ('body_type', 'apple', 'dresses_fit', 'wrap', '{}', 2),
  ('body_type', 'apple', 'dresses_fit', 'shift', '{}', 3),
  ('body_type', 'apple', 'dresses_length', 'midi', '{}', 1),
  ('body_type', 'apple', 'dresses_length', 'maxi', '{}', 2),
  ('body_type', 'apple', 'outerwear_fit', 'open-front', '{}', 1),
  ('body_type', 'apple', 'outerwear_fit', 'relaxed', '{}', 2),
  ('body_type', 'inverted triangle', 'tops_fit', 'regular', '{}', 1),
  ('body_type', 'inverted triangle', 'tops_fit', 'relaxed', '{}', 2),
  ('body_type', 'inverted triangle', 'tops_neckline', 'crew', '{}', 1),
  ('body_type', 'inverted triangle', 'tops_neckline', 'turtleneck', '{}', 2),
  ('body_type', 'inverted triangle', 'tops_neckline', 'boat', '{}', 3),
  ('body_type', 'inverted triangle', 'tops_neckline', 'high-neck', '{}', 4),
  ('body_type', 'inverted triangle', 'bottoms_fit', 'wide', '{}', 1),
  ('body_type', 'inverted triangle', 'bottoms_fit', 'relaxed', '{}', 2),
  ('body_type', 'inverted triangle', 'bottoms_fit', 'high-waist', '{}', 3),
  ('body_type', 'inverted triangle', 'bottoms_leg_opening', 'wide', '{}', 1),
  ('body_type', 'inverted triangle', 'bottoms_leg_opening', 'flare', '{}', 2),
  ('body_type', 'inverted triangle', 'bottoms_leg_opening', 'bootcut', '{}', 3),
  ('body_type', 'inverted triangle', 'bottoms_leg_opening', 'barrel', '{}', 4),
  ('body_type', 'inverted triangle', 'dresses_fit', 'a-line', '{}', 1),
  ('body_type', 'inverted triangle', 'dresses_fit', 'wrap', '{}', 2),
  ('body_type', 'inverted triangle', 'dresses_fit', 'fit and flare', '{}', 3),
  ('body_type', 'inverted triangle', 'dresses_length', 'midi', '{}', 1),
  ('body_type', 'inverted triangle', 'dresses_length', 'maxi', '{}', 2),
  ('body_type', 'inverted triangle', 'outerwear_fit', 'relaxed', '{}', 1),
  ('body_type', 'inverted triangle', 'outerwear_fit', 'oversized', '{}', 2),
  ('body_type', 'petite', 'tops_fit', 'fitted', '{}', 1),
  ('body_type', 'petite', 'tops_fit', 'slim', '{}', 2),
  ('body_type', 'petite', 'tops_fit', 'cropped', '{}', 3),
  ('body_type', 'petite', 'tops_length', 'crop', '{}', 1),
  ('body_type', 'petite', 'tops_length', 'waist-length', '{}', 2),
  ('body_type', 'petite', 'bottoms_fit', 'slim', '{}', 1),
  ('body_type', 'petite', 'bottoms_fit', 'fitted', '{}', 2),
  ('body_type', 'petite', 'bottoms_fit', 'skinny', '{}', 3),
  ('body_type', 'petite', 'bottoms_leg_opening', 'skinny', '{}', 1),
  ('body_type', 'petite', 'bottoms_leg_opening', 'straight', '{}', 2),
  ('body_type', 'petite', 'bottoms_leg_opening', 'tapered', '{}', 3),
  ('body_type', 'petite', 'dresses_fit', 'shift', '{}', 1),
  ('body_type', 'petite', 'dresses_fit', 'fitted', '{}', 2),
  ('body_type', 'petite', 'dresses_length', 'mini', '{}', 1),
  ('body_type', 'petite', 'dresses_length', 'knee', '{}', 2),
  ('body_type', 'petite', 'outerwear_fit', 'fitted', '{}', 1),
  ('body_type', 'petite', 'outerwear_fit', 'cropped', '{}', 2)
ON CONFLICT DO NOTHING;

-- Event tokens for weighted Jaccard occasion-similarity — recommendations.py
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  ('event_token', '', 'type', 'dinner', '{"token_type": "activity", "jaccard_weight": 3.0}', 1),
  ('event_token', '', 'type', 'brunch', '{"token_type": "activity", "jaccard_weight": 3.0}', 2),
  ('event_token', '', 'type', 'lunch', '{"token_type": "activity", "jaccard_weight": 3.0}', 3),
  ('event_token', '', 'type', 'breakfast', '{"token_type": "activity", "jaccard_weight": 3.0}', 4),
  ('event_token', '', 'type', 'interview', '{"token_type": "activity", "jaccard_weight": 3.0}', 5),
  ('event_token', '', 'type', 'meeting', '{"token_type": "activity", "jaccard_weight": 3.0}', 6),
  ('event_token', '', 'type', 'conference', '{"token_type": "activity", "jaccard_weight": 3.0}', 7),
  ('event_token', '', 'type', 'wedding', '{"token_type": "activity", "jaccard_weight": 3.0}', 8),
  ('event_token', '', 'type', 'gala', '{"token_type": "activity", "jaccard_weight": 3.0}', 9),
  ('event_token', '', 'type', 'cocktail', '{"token_type": "activity", "jaccard_weight": 3.0}', 10),
  ('event_token', '', 'type', 'party', '{"token_type": "activity", "jaccard_weight": 3.0}', 11),
  ('event_token', '', 'type', 'birthday', '{"token_type": "activity", "jaccard_weight": 3.0}', 12),
  ('event_token', '', 'type', 'celebration', '{"token_type": "activity", "jaccard_weight": 3.0}', 13),
  ('event_token', '', 'type', 'date', '{"token_type": "activity", "jaccard_weight": 3.0}', 14),
  ('event_token', '', 'type', 'concert', '{"token_type": "activity", "jaccard_weight": 3.0}', 15),
  ('event_token', '', 'type', 'ceremony', '{"token_type": "activity", "jaccard_weight": 3.0}', 16),
  ('event_token', '', 'type', 'reception', '{"token_type": "activity", "jaccard_weight": 3.0}', 17),
  ('event_token', '', 'type', 'bbq', '{"token_type": "activity", "jaccard_weight": 3.0}', 18),
  ('event_token', '', 'type', 'picnic', '{"token_type": "activity", "jaccard_weight": 3.0}', 19),
  ('event_token', '', 'type', 'workout', '{"token_type": "activity", "jaccard_weight": 3.0}', 20),
  ('event_token', '', 'type', 'gym', '{"token_type": "activity", "jaccard_weight": 3.0}', 21),
  ('event_token', '', 'type', 'hiking', '{"token_type": "activity", "jaccard_weight": 3.0}', 22),
  ('event_token', '', 'type', 'exhibition', '{"token_type": "activity", "jaccard_weight": 3.0}', 23),
  ('event_token', '', 'type', 'show', '{"token_type": "activity", "jaccard_weight": 3.0}', 24),
  ('event_token', '', 'type', 'beach', '{"token_type": "setting", "jaccard_weight": 2.0}', 1),
  ('event_token', '', 'type', 'office', '{"token_type": "setting", "jaccard_weight": 2.0}', 2),
  ('event_token', '', 'type', 'restaurant', '{"token_type": "setting", "jaccard_weight": 2.0}', 3),
  ('event_token', '', 'type', 'museum', '{"token_type": "setting", "jaccard_weight": 2.0}', 4),
  ('event_token', '', 'type', 'garden', '{"token_type": "setting", "jaccard_weight": 2.0}', 5),
  ('event_token', '', 'type', 'rooftop', '{"token_type": "setting", "jaccard_weight": 2.0}', 6),
  ('event_token', '', 'type', 'bar', '{"token_type": "setting", "jaccard_weight": 2.0}', 7),
  ('event_token', '', 'type', 'park', '{"token_type": "setting", "jaccard_weight": 2.0}', 8),
  ('event_token', '', 'type', 'lounge', '{"token_type": "setting", "jaccard_weight": 2.0}', 9),
  ('event_token', '', 'type', 'gallery', '{"token_type": "setting", "jaccard_weight": 2.0}', 10),
  ('event_token', '', 'type', 'hotel', '{"token_type": "setting", "jaccard_weight": 2.0}', 11),
  ('event_token', '', 'type', 'club', '{"token_type": "setting", "jaccard_weight": 2.0}', 12),
  ('event_token', '', 'type', 'outdoor', '{"token_type": "setting", "jaccard_weight": 2.0}', 13),
  ('event_token', '', 'type', 'indoor', '{"token_type": "setting", "jaccard_weight": 2.0}', 14)
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- v1.9.2 — new clothing categories: set, swimwear, loungewear
-- Adds CATEGORY_LABELS (CLIP), CATEGORY_DESCRIPTORS, and BODY_TYPE_PREFERENCES
-- rows for the three new categories.  ON CONFLICT DO NOTHING = idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- CLIP category labels
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  ('clip_label', '', 'category', 'set',        '{"clip_prompt":"a photo of a co-ord set or matching two-piece outfit with a coordinated top and bottom in the same fabric or print"}', 7),
  ('clip_label', '', 'category', 'swimwear',   '{"clip_prompt":"a photo of swimwear such as a bikini, one-piece swimsuit, tankini, monokini, or swim dress"}', 8),
  ('clip_label', '', 'category', 'loungewear', '{"clip_prompt":"a photo of loungewear, pajamas, sweatpants, joggers, a hoodie, or comfortable home or sleepwear clothing"}', 9)
ON CONFLICT DO NOTHING;

-- Descriptors: set
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  ('descriptor','set','fabric_type','cotton','{}',1),
  ('descriptor','set','fabric_type','polyester','{}',2),
  ('descriptor','set','fabric_type','linen','{}',3),
  ('descriptor','set','fabric_type','satin','{}',4),
  ('descriptor','set','fabric_type','silk','{}',5),
  ('descriptor','set','fabric_type','knit','{}',6),
  ('descriptor','set','fabric_type','denim','{}',7),
  ('descriptor','set','fabric_type','jersey','{}',8),
  ('descriptor','set','fabric_type','terry','{}',9),
  ('descriptor','set','fabric_type','tweed','{}',10),
  ('descriptor','set','fit','fitted','{}',1),
  ('descriptor','set','fit','regular','{}',2),
  ('descriptor','set','fit','relaxed','{}',3),
  ('descriptor','set','fit','oversized','{}',4),
  ('descriptor','set','fit','tailored','{}',5),
  ('descriptor','set','fit','wrap','{}',6),
  ('descriptor','set','top_style','crop','{}',1),
  ('descriptor','set','top_style','halter','{}',2),
  ('descriptor','set','top_style','bandeau','{}',3),
  ('descriptor','set','top_style','off-shoulder','{}',4),
  ('descriptor','set','top_style','bralette','{}',5),
  ('descriptor','set','top_style','blazer','{}',6),
  ('descriptor','set','top_style','shirt','{}',7),
  ('descriptor','set','top_style','camisole','{}',8),
  ('descriptor','set','top_style','waistcoat','{}',9),
  ('descriptor','set','bottom_style','shorts','{}',1),
  ('descriptor','set','bottom_style','mini skirt','{}',2),
  ('descriptor','set','bottom_style','midi skirt','{}',3),
  ('descriptor','set','bottom_style','trousers','{}',4),
  ('descriptor','set','bottom_style','wide-leg trousers','{}',5),
  ('descriptor','set','bottom_style','straight trousers','{}',6),
  ('descriptor','set','bottom_style','skirt','{}',7),
  ('descriptor','set','bottom_style','leggings','{}',8),
  ('descriptor','set','pattern','solid','{}',1),
  ('descriptor','set','pattern','floral','{}',2),
  ('descriptor','set','pattern','striped','{}',3),
  ('descriptor','set','pattern','plaid','{}',4),
  ('descriptor','set','pattern','abstract','{}',5),
  ('descriptor','set','pattern','animal print','{}',6),
  ('descriptor','set','pattern','geometric','{}',7),
  ('descriptor','set','pattern','tie-dye','{}',8),
  ('descriptor','set','closure','pullover','{}',1),
  ('descriptor','set','closure','button-front','{}',2),
  ('descriptor','set','closure','zip-up','{}',3),
  ('descriptor','set','closure','wrap','{}',4),
  ('descriptor','set','closure','hook-and-eye','{}',5),
  ('descriptor','set','detailing','ruffles','{}',1),
  ('descriptor','set','detailing','pleats','{}',2),
  ('descriptor','set','detailing','smocked','{}',3),
  ('descriptor','set','detailing','cut-out','{}',4),
  ('descriptor','set','detailing','lace trim','{}',5),
  ('descriptor','set','detailing','embroidery','{}',6)
ON CONFLICT DO NOTHING;

-- Descriptors: swimwear
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  ('descriptor','swimwear','swimwear_type','bikini','{}',1),
  ('descriptor','swimwear','swimwear_type','one-piece','{}',2),
  ('descriptor','swimwear','swimwear_type','tankini','{}',3),
  ('descriptor','swimwear','swimwear_type','monokini','{}',4),
  ('descriptor','swimwear','swimwear_type','swim dress','{}',5),
  ('descriptor','swimwear','swimwear_type','rash guard','{}',6),
  ('descriptor','swimwear','swimwear_type','swim shorts','{}',7),
  ('descriptor','swimwear','swimwear_type','boardshorts','{}',8),
  ('descriptor','swimwear','top_style','triangle','{}',1),
  ('descriptor','swimwear','top_style','bandeau','{}',2),
  ('descriptor','swimwear','top_style','underwire','{}',3),
  ('descriptor','swimwear','top_style','halter','{}',4),
  ('descriptor','swimwear','top_style','sports bra','{}',5),
  ('descriptor','swimwear','top_style','crop','{}',6),
  ('descriptor','swimwear','top_style','balconette','{}',7),
  ('descriptor','swimwear','coverage','minimal','{}',1),
  ('descriptor','swimwear','coverage','moderate','{}',2),
  ('descriptor','swimwear','coverage','full','{}',3),
  ('descriptor','swimwear','neckline','halter','{}',1),
  ('descriptor','swimwear','neckline','bandeau','{}',2),
  ('descriptor','swimwear','neckline','strapless','{}',3),
  ('descriptor','swimwear','neckline','V-neck','{}',4),
  ('descriptor','swimwear','neckline','square','{}',5),
  ('descriptor','swimwear','neckline','scoop','{}',6),
  ('descriptor','swimwear','neckline','off-shoulder','{}',7),
  ('descriptor','swimwear','neckline','high-neck','{}',8),
  ('descriptor','swimwear','fabric_type','polyester','{}',1),
  ('descriptor','swimwear','fabric_type','nylon','{}',2),
  ('descriptor','swimwear','fabric_type','spandex','{}',3),
  ('descriptor','swimwear','fabric_type','lycra','{}',4),
  ('descriptor','swimwear','fabric_type','recycled nylon','{}',5),
  ('descriptor','swimwear','pattern','solid','{}',1),
  ('descriptor','swimwear','pattern','floral','{}',2),
  ('descriptor','swimwear','pattern','animal print','{}',3),
  ('descriptor','swimwear','pattern','striped','{}',4),
  ('descriptor','swimwear','pattern','tropical','{}',5),
  ('descriptor','swimwear','pattern','geometric','{}',6),
  ('descriptor','swimwear','pattern','color-block','{}',7),
  ('descriptor','swimwear','closure','pull-on','{}',1),
  ('descriptor','swimwear','closure','tie-side','{}',2),
  ('descriptor','swimwear','closure','buckle','{}',3),
  ('descriptor','swimwear','closure','underwired','{}',4)
ON CONFLICT DO NOTHING;

-- Descriptors: loungewear
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  ('descriptor','loungewear','loungewear_type','hoodie','{}',1),
  ('descriptor','loungewear','loungewear_type','sweatshirt','{}',2),
  ('descriptor','loungewear','loungewear_type','sweatpants','{}',3),
  ('descriptor','loungewear','loungewear_type','joggers','{}',4),
  ('descriptor','loungewear','loungewear_type','pajama set','{}',5),
  ('descriptor','loungewear','loungewear_type','robe','{}',6),
  ('descriptor','loungewear','loungewear_type','shorts set','{}',7),
  ('descriptor','loungewear','loungewear_type','tank set','{}',8),
  ('descriptor','loungewear','loungewear_type','matching set','{}',9),
  ('descriptor','loungewear','loungewear_type','onesie','{}',10),
  ('descriptor','loungewear','fabric_type','cotton','{}',1),
  ('descriptor','loungewear','fabric_type','fleece','{}',2),
  ('descriptor','loungewear','fabric_type','modal','{}',3),
  ('descriptor','loungewear','fabric_type','silk','{}',4),
  ('descriptor','loungewear','fabric_type','satin','{}',5),
  ('descriptor','loungewear','fabric_type','jersey','{}',6),
  ('descriptor','loungewear','fabric_type','terry','{}',7),
  ('descriptor','loungewear','fabric_type','bamboo','{}',8),
  ('descriptor','loungewear','fabric_type','waffle-knit','{}',9),
  ('descriptor','loungewear','fit','oversized','{}',1),
  ('descriptor','loungewear','fit','relaxed','{}',2),
  ('descriptor','loungewear','fit','fitted','{}',3),
  ('descriptor','loungewear','fit','slim','{}',4),
  ('descriptor','loungewear','fit','regular','{}',5),
  ('descriptor','loungewear','closure','pullover','{}',1),
  ('descriptor','loungewear','closure','zip-up','{}',2),
  ('descriptor','loungewear','closure','button-front','{}',3),
  ('descriptor','loungewear','closure','open-front','{}',4),
  ('descriptor','loungewear','length','cropped','{}',1),
  ('descriptor','loungewear','length','regular','{}',2),
  ('descriptor','loungewear','length','longline','{}',3),
  ('descriptor','loungewear','pattern','solid','{}',1),
  ('descriptor','loungewear','pattern','plaid','{}',2),
  ('descriptor','loungewear','pattern','striped','{}',3),
  ('descriptor','loungewear','pattern','graphic','{}',4),
  ('descriptor','loungewear','pattern','tie-dye','{}',5),
  ('descriptor','loungewear','pattern','floral','{}',6),
  ('descriptor','loungewear','detailing','ribbed','{}',1),
  ('descriptor','loungewear','detailing','brushed','{}',2),
  ('descriptor','loungewear','detailing','waffle texture','{}',3),
  ('descriptor','loungewear','detailing','sherpa lined','{}',4),
  ('descriptor','loungewear','detailing','drawstring','{}',5),
  ('descriptor','loungewear','detailing','kangaroo pocket','{}',6),
  ('descriptor','loungewear','detailing','thumbhole','{}',7)
ON CONFLICT DO NOTHING;

-- Body-type preferences for new categories (set, swimwear, loungewear)
-- Format: category = body_type_name, attribute = clothing_category_attribute
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  -- hourglass
  ('body_type','hourglass','set_fit','fitted','{}',1),
  ('body_type','hourglass','set_fit','wrap','{}',2),
  ('body_type','hourglass','set_fit','tailored','{}',3),
  ('body_type','hourglass','set_bottom_style','midi skirt','{}',1),
  ('body_type','hourglass','set_bottom_style','mini skirt','{}',2),
  ('body_type','hourglass','set_bottom_style','trousers','{}',3),
  ('body_type','hourglass','swimwear_swimwear_type','bikini','{}',1),
  ('body_type','hourglass','swimwear_swimwear_type','one-piece','{}',2),
  ('body_type','hourglass','swimwear_coverage','moderate','{}',1),
  ('body_type','hourglass','loungewear_fit','fitted','{}',1),
  ('body_type','hourglass','loungewear_fit','relaxed','{}',2),
  ('body_type','hourglass','loungewear_loungewear_type','matching set','{}',1),
  ('body_type','hourglass','loungewear_loungewear_type','tank set','{}',2),
  -- rectangle
  ('body_type','rectangle','set_fit','relaxed','{}',1),
  ('body_type','rectangle','set_fit','oversized','{}',2),
  ('body_type','rectangle','set_fit','wrap','{}',3),
  ('body_type','rectangle','set_top_style','crop','{}',1),
  ('body_type','rectangle','set_top_style','off-shoulder','{}',2),
  ('body_type','rectangle','set_top_style','bralette','{}',3),
  ('body_type','rectangle','swimwear_swimwear_type','bikini','{}',1),
  ('body_type','rectangle','swimwear_swimwear_type','monokini','{}',2),
  ('body_type','rectangle','swimwear_top_style','bandeau','{}',1),
  ('body_type','rectangle','swimwear_top_style','triangle','{}',2),
  ('body_type','rectangle','loungewear_fit','oversized','{}',1),
  ('body_type','rectangle','loungewear_fit','relaxed','{}',2),
  ('body_type','rectangle','loungewear_loungewear_type','hoodie','{}',1),
  ('body_type','rectangle','loungewear_loungewear_type','matching set','{}',2),
  -- pear
  ('body_type','pear','set_fit','relaxed','{}',1),
  ('body_type','pear','set_fit','a-line','{}',2),
  ('body_type','pear','set_bottom_style','midi skirt','{}',1),
  ('body_type','pear','set_bottom_style','wide-leg trousers','{}',2),
  ('body_type','pear','swimwear_swimwear_type','tankini','{}',1),
  ('body_type','pear','swimwear_swimwear_type','one-piece','{}',2),
  ('body_type','pear','swimwear_swimwear_type','swim dress','{}',3),
  ('body_type','pear','swimwear_coverage','moderate','{}',1),
  ('body_type','pear','swimwear_coverage','full','{}',2),
  ('body_type','pear','loungewear_fit','relaxed','{}',1),
  ('body_type','pear','loungewear_fit','oversized','{}',2),
  ('body_type','pear','loungewear_loungewear_type','hoodie','{}',1),
  ('body_type','pear','loungewear_loungewear_type','joggers','{}',2),
  -- apple
  ('body_type','apple','set_fit','relaxed','{}',1),
  ('body_type','apple','set_fit','regular','{}',2),
  ('body_type','apple','set_top_style','camisole','{}',1),
  ('body_type','apple','set_top_style','shirt','{}',2),
  ('body_type','apple','set_top_style','waistcoat','{}',3),
  ('body_type','apple','swimwear_swimwear_type','one-piece','{}',1),
  ('body_type','apple','swimwear_swimwear_type','tankini','{}',2),
  ('body_type','apple','swimwear_swimwear_type','swim dress','{}',3),
  ('body_type','apple','swimwear_coverage','moderate','{}',1),
  ('body_type','apple','swimwear_coverage','full','{}',2),
  ('body_type','apple','loungewear_fit','relaxed','{}',1),
  ('body_type','apple','loungewear_fit','regular','{}',2),
  ('body_type','apple','loungewear_loungewear_type','robe','{}',1),
  ('body_type','apple','loungewear_loungewear_type','matching set','{}',2),
  -- inverted triangle
  ('body_type','inverted triangle','set_fit','relaxed','{}',1),
  ('body_type','inverted triangle','set_fit','regular','{}',2),
  ('body_type','inverted triangle','set_bottom_style','wide-leg trousers','{}',1),
  ('body_type','inverted triangle','set_bottom_style','midi skirt','{}',2),
  ('body_type','inverted triangle','set_bottom_style','skirt','{}',3),
  ('body_type','inverted triangle','swimwear_swimwear_type','bikini','{}',1),
  ('body_type','inverted triangle','swimwear_swimwear_type','one-piece','{}',2),
  ('body_type','inverted triangle','swimwear_top_style','bandeau','{}',1),
  ('body_type','inverted triangle','swimwear_top_style','balconette','{}',2),
  ('body_type','inverted triangle','loungewear_fit','relaxed','{}',1),
  ('body_type','inverted triangle','loungewear_fit','oversized','{}',2),
  ('body_type','inverted triangle','loungewear_loungewear_type','sweatpants','{}',1),
  ('body_type','inverted triangle','loungewear_loungewear_type','joggers','{}',2),
  -- petite
  ('body_type','petite','set_fit','fitted','{}',1),
  ('body_type','petite','set_fit','slim','{}',2),
  ('body_type','petite','set_bottom_style','mini skirt','{}',1),
  ('body_type','petite','set_bottom_style','shorts','{}',2),
  ('body_type','petite','set_bottom_style','straight trousers','{}',3),
  ('body_type','petite','swimwear_swimwear_type','bikini','{}',1),
  ('body_type','petite','swimwear_swimwear_type','monokini','{}',2),
  ('body_type','petite','swimwear_coverage','minimal','{}',1),
  ('body_type','petite','swimwear_coverage','moderate','{}',2),
  ('body_type','petite','loungewear_fit','fitted','{}',1),
  ('body_type','petite','loungewear_fit','slim','{}',2),
  ('body_type','petite','loungewear_loungewear_type','shorts set','{}',1),
  ('body_type','petite','loungewear_loungewear_type','tank set','{}',2)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- v1.9.3 — expanded descriptors for set / swimwear / loungewear
-- Adds top-half + bottom-half combo attributes for set, bra-type + bottom-type
-- attributes for swimwear, and top/bra/bottom additions for loungewear.
-- ON CONFLICT DO NOTHING = idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- Set: additional top-half descriptors
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  ('descriptor','set','neckline','crew neck','{}',1),
  ('descriptor','set','neckline','V-neck','{}',2),
  ('descriptor','set','neckline','square','{}',3),
  ('descriptor','set','neckline','scoop','{}',4),
  ('descriptor','set','neckline','off-shoulder','{}',5),
  ('descriptor','set','neckline','halter','{}',6),
  ('descriptor','set','neckline','high neck','{}',7),
  ('descriptor','set','neckline','cowl','{}',8),
  ('descriptor','set','sleeve_length','sleeveless','{}',1),
  ('descriptor','set','sleeve_length','short sleeve','{}',2),
  ('descriptor','set','sleeve_length','3/4 sleeve','{}',3),
  ('descriptor','set','sleeve_length','long sleeve','{}',4),
  ('descriptor','set','sleeve_style','straight','{}',1),
  ('descriptor','set','sleeve_style','flared','{}',2),
  ('descriptor','set','sleeve_style','puffed','{}',3),
  ('descriptor','set','sleeve_style','flutter','{}',4),
  ('descriptor','set','sleeve_style','bishop','{}',5),
  ('descriptor','set','strap_type','none','{}',1),
  ('descriptor','set','strap_type','spaghetti','{}',2),
  ('descriptor','set','strap_type','thick','{}',3),
  ('descriptor','set','strap_type','one-shoulder','{}',4),
  ('descriptor','set','back_style','open back','{}',1),
  ('descriptor','set','back_style','closed back','{}',2),
  ('descriptor','set','back_style','lace-up back','{}',3),
  ('descriptor','set','back_style','keyhole back','{}',4),
  -- Set: additional bottom-half descriptors
  ('descriptor','set','waist_position','low-rise','{}',1),
  ('descriptor','set','waist_position','mid-rise','{}',2),
  ('descriptor','set','waist_position','high-rise','{}',3),
  ('descriptor','set','waist_structure','elastic','{}',1),
  ('descriptor','set','waist_structure','drawstring','{}',2),
  ('descriptor','set','waist_structure','structured','{}',3),
  ('descriptor','set','waist_structure','tie','{}',4),
  ('descriptor','set','leg_opening','straight','{}',1),
  ('descriptor','set','leg_opening','flared','{}',2),
  ('descriptor','set','leg_opening','tapered','{}',3),
  ('descriptor','set','leg_opening','wide','{}',4),
  ('descriptor','set','hemline','straight','{}',1),
  ('descriptor','set','hemline','asymmetric','{}',2),
  ('descriptor','set','hemline','ruffled','{}',3),
  ('descriptor','set','hemline','hi-lo','{}',4),
  ('descriptor','set','length','mini','{}',1),
  ('descriptor','set','length','midi','{}',2),
  ('descriptor','set','length','maxi','{}',3),
  ('descriptor','set','length','cropped','{}',4),
  ('descriptor','set','elasticity','stretch','{}',1),
  ('descriptor','set','elasticity','non-stretch','{}',2),
  ('descriptor','set','elasticity','4-way stretch','{}',3)
ON CONFLICT DO NOTHING;

-- Swimwear: top_coverage + bra-type + underwear-bottom attributes
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  -- top_coverage (replaces the old "coverage" key in LLM descriptors)
  ('descriptor','swimwear','top_coverage','minimal','{}',1),
  ('descriptor','swimwear','top_coverage','moderate','{}',2),
  ('descriptor','swimwear','top_coverage','full','{}',3),
  -- bra-type: support level
  ('descriptor','swimwear','support','low','{}',1),
  ('descriptor','swimwear','support','medium','{}',2),
  ('descriptor','swimwear','support','high','{}',3),
  -- bra-type: structure
  ('descriptor','swimwear','structure','wired','{}',1),
  ('descriptor','swimwear','structure','wireless','{}',2),
  ('descriptor','swimwear','structure','padded','{}',3),
  ('descriptor','swimwear','structure','unlined','{}',4),
  -- bra-type: function
  ('descriptor','swimwear','function','everyday','{}',1),
  ('descriptor','swimwear','function','sports','{}',2),
  ('descriptor','swimwear','function','beach','{}',3),
  ('descriptor','swimwear','function','special occasion','{}',4),
  -- bra-type: fit intent
  ('descriptor','swimwear','fit_intent','enhance','{}',1),
  ('descriptor','swimwear','fit_intent','minimize','{}',2),
  ('descriptor','swimwear','fit_intent','natural','{}',3),
  -- bottom: rise
  ('descriptor','swimwear','bottom_rise','low','{}',1),
  ('descriptor','swimwear','bottom_rise','mid','{}',2),
  ('descriptor','swimwear','bottom_rise','high','{}',3),
  -- bottom: back coverage
  ('descriptor','swimwear','back_coverage','minimal','{}',1),
  ('descriptor','swimwear','back_coverage','partial','{}',2),
  ('descriptor','swimwear','back_coverage','full','{}',3),
  -- bottom: fit style
  ('descriptor','swimwear','bottom_fit_style','thong','{}',1),
  ('descriptor','swimwear','bottom_fit_style','bikini','{}',2),
  ('descriptor','swimwear','bottom_fit_style','boyshort','{}',3),
  ('descriptor','swimwear','bottom_fit_style','brief','{}',4),
  ('descriptor','swimwear','bottom_fit_style','high-waist','{}',5),
  ('descriptor','swimwear','bottom_fit_style','hipster','{}',6),
  ('descriptor','swimwear','bottom_fit_style','cheeky','{}',7),
  ('descriptor','swimwear','bottom_fit_style','string','{}',8),
  -- bottom: visibility / lining
  ('descriptor','swimwear','bottom_visibility','seamless','{}',1),
  ('descriptor','swimwear','bottom_visibility','no-show','{}',2),
  ('descriptor','swimwear','bottom_visibility','regular','{}',3)
ON CONFLICT DO NOTHING;

-- Loungewear: top-half, light-bra, and bottom-half additions
INSERT INTO public.style_taxonomy (domain, category, attribute, value, meta, sort_order)
VALUES
  -- top-half: neckline
  ('descriptor','loungewear','neckline','crew neck','{}',1),
  ('descriptor','loungewear','neckline','V-neck','{}',2),
  ('descriptor','loungewear','neckline','scoop','{}',3),
  ('descriptor','loungewear','neckline','square','{}',4),
  ('descriptor','loungewear','neckline','cowl','{}',5),
  ('descriptor','loungewear','neckline','mock neck','{}',6),
  -- top-half: sleeve length
  ('descriptor','loungewear','sleeve_length','sleeveless','{}',1),
  ('descriptor','loungewear','sleeve_length','short sleeve','{}',2),
  ('descriptor','loungewear','sleeve_length','3/4 sleeve','{}',3),
  ('descriptor','loungewear','sleeve_length','long sleeve','{}',4),
  -- top-half: strap type
  ('descriptor','loungewear','strap_type','none','{}',1),
  ('descriptor','loungewear','strap_type','spaghetti','{}',2),
  ('descriptor','loungewear','strap_type','thick','{}',3),
  -- light bra: support level
  ('descriptor','loungewear','support','none','{}',1),
  ('descriptor','loungewear','support','light','{}',2),
  ('descriptor','loungewear','support','medium','{}',3),
  -- light bra: structure
  ('descriptor','loungewear','structure','wireless','{}',1),
  ('descriptor','loungewear','structure','padded','{}',2),
  ('descriptor','loungewear','structure','unlined','{}',3),
  ('descriptor','loungewear','structure','built-in','{}',4),
  -- light bra: fit intent
  ('descriptor','loungewear','fit_intent','enhance','{}',1),
  ('descriptor','loungewear','fit_intent','minimize','{}',2),
  ('descriptor','loungewear','fit_intent','natural','{}',3),
  -- bottom-half: waist structure
  ('descriptor','loungewear','waist_structure','elastic','{}',1),
  ('descriptor','loungewear','waist_structure','drawstring','{}',2),
  ('descriptor','loungewear','waist_structure','tie','{}',3),
  -- bottom-half: bottom length
  ('descriptor','loungewear','bottom_length','shorts','{}',1),
  ('descriptor','loungewear','bottom_length','capri','{}',2),
  ('descriptor','loungewear','bottom_length','ankle','{}',3),
  ('descriptor','loungewear','bottom_length','full-length','{}',4)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- v1.9.4 — SECURITY DEFINER helper functions for reliable clothing item writes
-- PostgREST UPDATE is unreliable with supabase-py 2.4.x / postgrest-py.
-- These functions run as the table OWNER (postgres), bypassing RLS entirely,
-- identical to what the Supabase SQL editor executes directly.
-- Run each CREATE OR REPLACE statement in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Soft-delete an item (sets is_active=false, records deleted_at).
--    Returns true if the row was found and updated, false otherwise.
CREATE OR REPLACE FUNCTION public.soft_delete_clothing_item(
  p_item_id  uuid,
  p_user_id  uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE clothing_items
     SET is_active  = false,
         deleted_at = now()
   WHERE id      = p_item_id
     AND user_id = p_user_id;
  RETURN FOUND;
END;
$$;

-- 2. Restore a soft-deleted item (sets is_active=true, clears deleted_at).
--    Returns true if found and restored.
CREATE OR REPLACE FUNCTION public.restore_clothing_item(
  p_item_id  uuid,
  p_user_id  uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE clothing_items
     SET is_active  = true,
         deleted_at = null
   WHERE id      = p_item_id
     AND user_id = p_user_id;
  RETURN FOUND;
END;
$$;

-- 3. Update editable tags on a clothing item.
--    Only non-NULL arguments overwrite the stored value (COALESCE pattern).
--    p_descriptors is a JSON string; its keys are merged into the existing descriptors JSONB.
--    Returns the updated row as JSONB, or NULL if not found.
CREATE OR REPLACE FUNCTION public.update_clothing_item_tags(
  p_item_id         uuid,
  p_user_id         uuid,
  p_category        text    DEFAULT NULL,
  p_color           text    DEFAULT NULL,
  p_season          text    DEFAULT NULL,
  p_formality_score float   DEFAULT NULL,
  p_item_type       text    DEFAULT NULL,
  p_descriptors     text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result      jsonb;
  v_descriptors jsonb;
BEGIN
  -- Parse descriptor overrides (null-safe)
  IF p_descriptors IS NOT NULL THEN
    v_descriptors := p_descriptors::jsonb;
  END IF;

  UPDATE clothing_items
     SET category        = COALESCE(p_category,        category),
         color           = COALESCE(p_color,           color),
         season          = COALESCE(p_season,          season),
         formality_score = COALESCE(p_formality_score, formality_score),
         item_type       = COALESCE(p_item_type,       item_type),
         -- merge: existing descriptors || new keys (new keys win on conflict)
         descriptors     = CASE
                             WHEN v_descriptors IS NOT NULL
                             THEN COALESCE(descriptors, '{}'::jsonb) || v_descriptors
                             ELSE descriptors
                           END
   WHERE id      = p_item_id
     AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(ci.*)
    INTO v_result
    FROM clothing_items ci
   WHERE id = p_item_id;

  RETURN v_result;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- v2.0.0 — Outfit card column for structured quick-glance suggestion summaries
-- Replaces the long LLM explanation paragraph with metric tiles + verdict.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE outfit_suggestions
  ADD COLUMN IF NOT EXISTS card jsonb;

COMMENT ON COLUMN outfit_suggestions.card IS
  'Structured outfit card — trend_meter, vibe, color_story, fit_check, '
  'occasion_match, weather_sync, risk_flag, verdict. Generated by v2 scorer.';


-- ─────────────────────────────────────────────────────────────────────────────
-- v2.1.0 — Age range field on user profile
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS age_range text;
