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
  body_type                text,
  height_cm                float,
  weight_kg                float,
  complexion               text,
  face_shape               text,
  hairstyle                text,
  preferred_styles         jsonb default '{}',
  disliked_styles          jsonb default '{}',
  photo_url                text,
  ai_profile_photo_url     text,
  ai_profile_analysis      jsonb default '{}',
  ai_profile_analyzed_at   timestamptz,
  is_pro                   boolean default false,
  favorite_photo_embedding vector(512),   -- CLIP embedding of user's style photo
  created_at               timestamptz default now()
);


-- ── Clothing Items ─────────────────────────────────────────────────────────
create table if not exists clothing_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  category           text not null,        -- tops | bottoms | dresses | shoes | outerwear | accessories
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


-- ── Row Level Security ────────────────────────────────────────────────────
-- Users can only see and modify their own data

alter table users              enable row level security;
alter table clothing_items     enable row level security;
alter table events             enable row level security;
alter table outfit_suggestions enable row level security;

-- Users table policies
create policy "Users can view own profile"
  on users for select using (auth.uid() = id);
create policy "Users can update own profile"
  on users for update using (auth.uid() = id);

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
