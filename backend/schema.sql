-- ═══════════════════════════════════════════════════════════════════
-- LuxeLook AI — Supabase Database Schema
-- Run this in your Supabase project's SQL Editor (supabase.com/dashboard)
-- ═══════════════════════════════════════════════════════════════════

-- Enable the pgvector extension for embedding storage & similarity search
create extension if not exists vector;


-- ── Users ──────────────────────────────────────────────────────────────────
-- References Supabase Auth's built-in auth.users table via UUID
create table if not exists users (
  id                       uuid primary key references auth.users(id) on delete cascade,
  email                    text not null,
  gender                   text not null default 'prefer_not_to_say',
  ethnicity                text not null default 'prefer_not_to_say',
  body_type                text,
  height_cm                float,
  weight_kg                float,
  complexion               text,
  face_shape               text,
  hairstyle                text,
  photo_url                text,
  ai_profile_photo_url     text,
  ai_profile_analysis      jsonb default '{}',
  ai_profile_analyzed_at   timestamptz,
  is_pro                   boolean default false,
  created_at               timestamptz default now()
);


-- ── Clothing Items ─────────────────────────────────────────────────────────
create table if not exists clothing_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  category           text not null,        -- tops | bottoms | dresses | jumpsuits | shoes | outerwear | accessories
  item_type          text not null,        -- core_garment | footwear | outerwear | accessory
  accessory_subtype  text,                 -- jewelry | bag | belt | scarf | other (nullable)
  color              text,
  pattern            text,                 -- stripes | plaid | floral | polka_dots | animal_print | geometric | abstract (null = solid)
  season             text default 'all',   -- spring | summer | fall | winter | all
  formality_score    float check (formality_score between 0 and 1),
  image_url          text not null,
  thumbnail_url      text,
  cutout_url         text,
  media_status       text default 'pending',
  media_stage        text,
  media_error        text,
  media_updated_at   timestamptz,
  updated_at         timestamptz default now(),
  deleted_at         timestamptz default null,
  is_active          boolean default true,
  is_archived        boolean default false,
  archived_on        timestamptz default null,
  embedding_vector   vector(512),          -- CLIP visual embedding
  created_at         timestamptz default now()
);

-- Index for fast user wardrobe queries
create index if not exists idx_clothing_user on clothing_items(user_id);

-- Index for vector similarity search (cosine distance)
create index if not exists idx_clothing_embedding
  on clothing_items using ivfflat (embedding_vector vector_cosine_ops)
  with (lists = 100);


-- ── Events ────────────────────────────────────────────────────────────────
create table if not exists events (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users(id) on delete cascade,
  raw_text             text not null,          -- original user input
  occasion_type        text not null,          -- formal | casual | business | party | etc.
  formality_level      float check (formality_level between 0 and 1),
  temperature_context  text,                   -- indoor | outdoor | mixed | unknown
  setting              text,                   -- restaurant | beach | office | etc.
  created_at           timestamptz default now()
);

create index if not exists idx_events_user on events(user_id);


-- ── Outfit Suggestions ────────────────────────────────────────────────────
create table if not exists outfit_suggestions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  event_id        uuid not null references events(id) on delete cascade,
  item_ids        uuid[] not null,     -- core garments
  accessory_ids   uuid[] default '{}', -- up to 2 accessories (can be empty)
  score           float,               -- composite recommendation score 0–1
  explanation     text,                -- LLM-generated rationale
  user_rating     int check (user_rating between 1 and 5),  -- feedback
  generated_at    timestamptz default now()
);

create index if not exists idx_outfits_user  on outfit_suggestions(user_id);
create index if not exists idx_outfits_event on outfit_suggestions(event_id);


-- ── Style Catalog ─────────────────────────────────────────────────────────
create table if not exists style_catalog (
  id            uuid primary key default gen_random_uuid(),
  style_key     text not null unique,
  label         text not null,
  dimension     text not null,
  description   text,
  aliases       jsonb default '[]'::jsonb,
  sort_order    int default 0,
  is_active     boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists idx_style_catalog_dimension on style_catalog(dimension);
create index if not exists idx_style_catalog_key on style_catalog(style_key);


-- ── Discover Ignore URLs ──────────────────────────────────────────────────
create table if not exists discover_ignored_urls (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  source_url      text not null,
  normalized_url  text not null,
  image_url       text,
  thumbnail_url   text,
  source_domain   text,
  search_query    text,
  last_action     text,
  reason          text,
  last_seen_at    timestamptz default now(),
  created_at      timestamptz default now(),
  unique (user_id, normalized_url)
);

create index if not exists idx_discover_ignored_user on discover_ignored_urls(user_id);


-- ── Discover Swipe Interactions ───────────────────────────────────────────
create table if not exists discover_style_interactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  card_id         text not null,
  source_url      text not null,
  normalized_url  text not null,
  image_url       text not null,
  thumbnail_url   text,
  source_domain   text,
  title           text not null,
  summary         text,
  search_query    text,
  style_ids       text[] default '{}',
  style_tags      text[] default '{}',
  action          text not null check (action in ('love', 'like', 'dislike')),
  person_count    int default 1,
  is_single_person boolean default true,
  analysis        jsonb default '{}',
  interaction_index int,
  created_at      timestamptz default now()
);

create index if not exists idx_discover_swipe_user on discover_style_interactions(user_id);
create index if not exists idx_discover_swipe_url on discover_style_interactions(user_id, normalized_url);


-- ── Discover Candidate Cache ──────────────────────────────────────────────
create table if not exists discover_candidates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  normalized_url    text not null,
  source_url        text not null,
  image_url         text not null,
  thumbnail_url     text,
  source_domain     text,
  provider_name     text,
  title             text not null,
  summary           text,
  source_note       text,
  search_query      text,
  status            text not null default 'queued' check (status in ('queued', 'ready', 'filtered', 'failed')),
  analysis          jsonb default '{}',
  style_tags        text[] default '{}',
  style_ids         text[] default '{}',
  person_count      int default 0,
  is_single_person  boolean default false,
  last_error        text,
  last_analyzed_at  timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (user_id, normalized_url)
);

create index if not exists idx_discover_candidates_user on discover_candidates(user_id);
create index if not exists idx_discover_candidates_status on discover_candidates(user_id, status, updated_at);


-- ── User Style Preferences ────────────────────────────────────────────────
create table if not exists user_style_preferences (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  style_id          text not null,
  style_key         text not null,
  label             text not null,
  dimension         text not null,
  score             float default 0,
  confidence        float default 0,
  exposure_count    int default 0,
  love_count        int default 0,
  like_count        int default 0,
  dislike_count     int default 0,
  positive_count    int default 0,
  negative_count    int default 0,
  status            text default 'emerging',
  last_interaction_at timestamptz,
  updated_at        timestamptz default now(),
  created_at        timestamptz default now(),
  unique (user_id, style_id)
);

create index if not exists idx_user_style_preferences_user on user_style_preferences(user_id);
create index if not exists idx_user_style_preferences_status on user_style_preferences(user_id, status);


-- ── Discover Background Jobs ──────────────────────────────────────────────
create table if not exists discover_jobs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  job_type          text not null,
  status            text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  priority          int default 100,
  payload           jsonb default '{}',
  dedupe_key        text,
  attempts          int default 0,
  max_attempts      int default 3,
  scheduled_for     timestamptz default now(),
  locked_at         timestamptz,
  locked_by         text,
  last_error        text,
  result            jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_discover_jobs_user on discover_jobs(user_id);
create index if not exists idx_discover_jobs_status on discover_jobs(status, scheduled_for, priority);


-- ── Row Level Security ────────────────────────────────────────────────────
-- Users can only see and modify their own data

alter table users              enable row level security;
alter table clothing_items     enable row level security;
alter table events             enable row level security;
alter table outfit_suggestions enable row level security;
alter table style_catalog      enable row level security;
alter table discover_candidates enable row level security;
alter table discover_ignored_urls enable row level security;
alter table discover_style_interactions enable row level security;
alter table user_style_preferences enable row level security;
alter table discover_jobs enable row level security;

-- Users table policies
create policy "Users can view own profile"
  on users for select using (auth.uid() = id);
create policy "Users can update own profile"
  on users for update using (auth.uid() = id);

-- Style catalog is readable by authenticated users
create policy "Style catalog is readable"
  on style_catalog for select using (true);

-- Discover support tables are scoped to the current user
create policy "Users can view own discover candidates"
  on discover_candidates for select using (auth.uid() = user_id);
create policy "Users can insert own discover candidates"
  on discover_candidates for insert with check (auth.uid() = user_id);
create policy "Users can update own discover candidates"
  on discover_candidates for update using (auth.uid() = user_id);

create policy "Users can view own ignored discover URLs"
  on discover_ignored_urls for select using (auth.uid() = user_id);
create policy "Users can insert own ignored discover URLs"
  on discover_ignored_urls for insert with check (auth.uid() = user_id);
create policy "Users can update own ignored discover URLs"
  on discover_ignored_urls for update using (auth.uid() = user_id);

create policy "Users can view own discover interactions"
  on discover_style_interactions for select using (auth.uid() = user_id);
create policy "Users can insert own discover interactions"
  on discover_style_interactions for insert with check (auth.uid() = user_id);

create policy "Users can view own style preferences"
  on user_style_preferences for select using (auth.uid() = user_id);
create policy "Users can insert own style preferences"
  on user_style_preferences for insert with check (auth.uid() = user_id);
create policy "Users can update own style preferences"
  on user_style_preferences for update using (auth.uid() = user_id);

create policy "Users can view own discover jobs"
  on discover_jobs for select using (auth.uid() = user_id);
create policy "Users can insert own discover jobs"
  on discover_jobs for insert with check (auth.uid() = user_id);
create policy "Users can update own discover jobs"
  on discover_jobs for update using (auth.uid() = user_id);

-- Clothing items policies
create policy "Users can view own clothing"
  on clothing_items for select using (auth.uid() = user_id);
create policy "Users can insert own clothing"
  on clothing_items for insert with check (auth.uid() = user_id);
create policy "Users can delete own clothing"
  on clothing_items for delete using (auth.uid() = user_id);

-- Events policies
create policy "Users can view own events"
  on events for select using (auth.uid() = user_id);
create policy "Users can insert own events"
  on events for insert with check (auth.uid() = user_id);

-- Outfit suggestions policies
create policy "Users can view own outfits"
  on outfit_suggestions for select using (auth.uid() = user_id);
create policy "Users can update own outfit ratings"
  on outfit_suggestions for update using (auth.uid() = user_id);


-- ── Storage Bucket ────────────────────────────────────────────────────────
-- Run this in the Supabase Dashboard → Storage, OR via the CLI:
-- supabase storage create clothing-images --public false
--
-- Then add this policy in Storage > Policies:
-- Allow authenticated users to upload to their own folder:
--   (storage.foldername(name))[1] = auth.uid()::text

-- ── Migration: add pattern column if upgrading an existing database ──────────
-- Skip this block if running schema.sql fresh (the column above already exists).
-- Run ONLY if you already have a clothing_items table without the pattern column:
--
--   alter table clothing_items add column if not exists pattern text;
