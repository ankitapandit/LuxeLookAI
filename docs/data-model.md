# LuxeLook AI Data Model

This document is the conceptual reference for LuxeLook AI's current product data.
For the full system view, including access control, activity flow, and architecture diagrams, see:
- [`/Users/anki/Desktop/Code/LuxeLookAI/luxelook-ai/docs/system-architecture.md`](/Users/anki/Desktop/Code/LuxeLookAI/luxelook-ai/docs/system-architecture.md)

It is intended to be read alongside:
- [`/Users/anki/Desktop/Code/LuxeLookAI/luxelook-ai/backend/schema.sql`](/Users/anki/Desktop/Code/LuxeLookAI/luxelook-ai/backend/schema.sql)
- [`/Users/anki/Desktop/Code/LuxeLookAI/luxelook-ai/backend/supabase_migrations.sql`](/Users/anki/Desktop/Code/LuxeLookAI/luxelook-ai/backend/supabase_migrations.sql)

The goal here is not just raw DDL. This file explains:
- what each table means in product terms
- which tables are primary vs derived/cache-like
- how data cascades on delete
- how the wardrobe, event, and Discover systems relate

All timestamps are stored in UTC in the database. Some application logic, such as Discover daily quota checks, interprets those UTC timestamps in the client’s local timezone at request time.

## Domain Overview

LuxeLook AI currently has seven main data domains:

1. `Identity & profile`
2. `Wardrobe`
3. `Batch intake & verification`
4. `Occasions, outfit suggestions, and style-direction feedback`
5. `Style vocabulary / taxonomy`
6. `Discover taste learning`
7. `Route-level product activity`

## Entity Relationship Diagram

```mermaid
erDiagram
    AUTH_USERS ||--|| USERS : "provisions"
    USERS ||--o{ CLOTHING_ITEMS : "owns"
    USERS ||--o{ UPLOAD_BATCH_SESSIONS : "starts"
    USERS ||--o{ UPLOAD_BATCH_ITEMS : "reviews"
    USERS ||--o{ EVENTS : "creates"
    USERS ||--o{ OUTFIT_SUGGESTIONS : "receives"
    USERS ||--o{ STYLE_DIRECTION_FEEDBACK : "rates AI style directions"
    EVENTS ||--o{ OUTFIT_SUGGESTIONS : "produces"
    EVENTS ||--o{ STYLE_DIRECTION_FEEDBACK : "collects usefulness votes"
    UPLOAD_BATCH_SESSIONS ||--o{ UPLOAD_BATCH_ITEMS : "contains"
    UPLOAD_BATCH_ITEMS }o--|| CLOTHING_ITEMS : "may create"

    USERS ||--o{ DISCOVER_CANDIDATES : "warms"
    USERS ||--o{ DISCOVER_STYLE_INTERACTIONS : "swipes"
    USERS ||--o{ DISCOVER_IGNORED_URLS : "excludes"
    USERS ||--o{ DISCOVER_USER_STATE : "tracks active Discover days"
    USERS ||--o{ DISCOVER_FAMILY_MEMORY : "stores family cooldowns"
    USERS ||--o{ USER_STYLE_PREFERENCES : "learns"
    USERS ||--o{ DISCOVER_JOBS : "queues"
    USERS ||--o{ USER_PAGE_VISITS : "navigates"

    STYLE_CATALOG ||--o{ USER_STYLE_PREFERENCES : "references by style_id/style_key"
    STYLE_TAXONOMY }o--o{ CLOTHING_ITEMS : "supplies tagging vocabulary"
    STYLE_TAXONOMY }o--o{ OUTFIT_SUGGESTIONS : "supplies scoring vocabulary"

    USERS {
      uuid id PK
      text email
      text gender
      text ethnicity
      text body_type
      float height_cm
      float weight_kg
      text complexion
      text face_shape
      text hairstyle
      text age_range
    }

    CLOTHING_ITEMS {
      uuid id PK
      uuid user_id FK
      text category
      text brand
      text item_type
      text accessory_subtype
      text color
      text pattern
      text season
      float formality_score
      text image_url
      text thumbnail_url
      text cutout_url
      jsonb descriptors
      text verification_status
      text ingestion_source
      boolean is_active
      boolean is_archived
      timestamptz archived_on
      timestamptz deleted_at
    }

    UPLOAD_BATCH_SESSIONS {
      uuid id PK
      uuid user_id FK
      text status
      int total_count
      int uploaded_count
      int processed_count
      int awaiting_verification_count
      int verified_count
      int failed_count
      timestamptz created_at
      timestamptz completed_at
    }

    UPLOAD_BATCH_ITEMS {
      uuid id PK
      uuid session_id FK
      uuid user_id FK
      text file_name
      text image_url
      text thumbnail_url
      text cutout_url
      text status
      text error_message
      uuid clothing_item_id FK
      timestamptz verified_at
    }

    EVENTS {
      uuid id PK
      uuid user_id FK
      text raw_text
      text occasion_type
      float formality_level
      text temperature_context
      text setting
    }

    OUTFIT_SUGGESTIONS {
      uuid id PK
      uuid user_id FK
      uuid event_id FK
      uuid[] item_ids
      uuid[] accessory_ids
      float score
      text explanation
      int user_rating
      jsonb card
    }

    STYLE_DIRECTION_FEEDBACK {
      uuid id PK
      uuid user_id FK
      uuid event_id FK
      text option_name
      text feedback_value
      jsonb option_snapshot
      timestamptz created_at
      timestamptz updated_at
    }

    STYLE_CATALOG {
      uuid id PK
      text style_key UK
      text label
      text dimension
      jsonb aliases
      boolean is_active
    }

    STYLE_TAXONOMY {
      bigint id PK
      text domain
      text category
      text attribute
      text value
      jsonb meta
    }

    DISCOVER_CANDIDATES {
      uuid id PK
      uuid user_id FK
      text normalized_url
      text source_url
      text image_url
      text provider_name
      text status
      jsonb analysis
      text[] style_tags
      int person_count
    }

    DISCOVER_STYLE_INTERACTIONS {
      uuid id PK
      uuid user_id FK
      text normalized_url
      text action
      text[] style_ids
      text[] style_tags
      int interaction_index
      timestamptz created_at
    }

    DISCOVER_IGNORED_URLS {
      uuid id PK
      uuid user_id FK
      text normalized_url
      text reason
      text last_action
    }

    USER_STYLE_PREFERENCES {
      uuid id PK
      uuid user_id FK
      text style_id
      text style_key
      text dimension
      float score
      float confidence
      int exposure_count
      text status
    }

    DISCOVER_JOBS {
      uuid id PK
      uuid user_id FK
      text job_type
      text status
      jsonb payload
      jsonb result
      int attempts
    }

    DISCOVER_USER_STATE {
      uuid id PK
      uuid user_id FK
      int total_interactions
      text[] recent_family_keys
      timestamptz last_discover_at
    }

    DISCOVER_FAMILY_MEMORY {
      uuid id PK
      uuid user_id FK
      text family_key
      text family_label
      int cooldown_until_active_day
      timestamptz last_discover_active_at
    }

    USER_PAGE_VISITS {
      uuid id PK
      uuid user_id FK
      text page_name
      timestamptz entered_at
      timestamptz left_at
    }
```

## Lifecycle and Cascade Rules

The most important cascade rule in the app today:

- Deleting a row in `users` cascades into:
  - `clothing_items`
  - `upload_batch_sessions`
  - `upload_batch_items`
  - `events`
  - `outfit_suggestions`
  - `style_direction_feedback`
  - `discover_candidates`
  - `discover_style_interactions`
  - `discover_ignored_urls`
  - `discover_user_state`
  - `discover_family_memory`
  - `user_style_preferences`
  - `discover_jobs`
  - `user_page_visits`

These Discover tables do **not** cascade into one another directly.

Examples:
- deleting a Discover candidate does not delete its swipe interactions
- deleting a Discover interaction does not delete learned preference rows
- deleting the user deletes all of them

## Table-by-Table Conceptual Model

### 1. `auth.users` (external Supabase auth table)

This is the identity source managed by Supabase Auth, not by app code.

Purpose:
- canonical authentication identity
- source of the UUID copied into `public.users`

App relationship:
- `public.users.id` references `auth.users.id`
- `handle_new_user()` backfills the app profile row on signup

### 2. `public.users`

Product meaning:
- the persisted personal stylist profile for one signed-in user

Primary responsibilities:
- demographic/profile context
- styling context
- avatar and AI profiling image references

Record sketch:

```yaml
users:
  id: uuid
  email: text
  gender: text
  ethnicity: text
  body_type: text?
  height_cm: float?
  weight_kg: float?
  complexion: text?
  face_shape: text?
  hairstyle: text?
  age_range: text?
  photo_url: text?
  ai_profile_photo_url: text?
  ai_profile_analysis: jsonb
  ai_profile_analyzed_at: timestamptz?
  is_pro: boolean
  created_at: timestamptz
```

Notes:
- `gender` and `ethnicity` default to `prefer_not_to_say`
- `ai_profile_analysis` is structured but intentionally flexible JSON
- this table is intentionally kept clean; Discover learning lives in separate tables

### 3. `public.clothing_items`

Product meaning:
- one wardrobe item owned by one user

Primary responsibilities:
- garment identity and categorization
- source/original image and derived media
- style descriptors
- archive / active state

Record sketch:

```yaml
clothing_items:
  id: uuid
  user_id: uuid
  category: text
  brand: text?
  item_type: text
  accessory_subtype: text?
  color: text?
  pattern: text?
  season: text
  formality_score: float?
  image_url: text
  thumbnail_url: text?
  cutout_url: text?
  media_status: text?
  media_stage: text?
  media_error: text?
  media_updated_at: timestamptz?
  descriptors: jsonb
  embedding_vector: vector(512)?
  verification_status: text?
  ingestion_source: text?
  is_active: boolean
  is_archived: boolean
  archived_on: timestamptz?
  deleted_at: timestamptz?
  updated_at: timestamptz
  created_at: timestamptz
```

Notes:
- `descriptors` is migration-added JSONB and conceptually part of the live schema
- `brand` is optional and validated against the shared curated catalog instead of free text
- `is_active = false` plus `is_archived = true` represents the archived state
- `thumbnail_url` and `cutout_url` are derived media, not user-authored data
- `embedding_vector` powers duplicate detection and visual similarity

### 4. `public.upload_batch_sessions`

Product meaning:
- one multi-photo intake session for a user

Primary responsibilities:
- track session-level upload/review progress
- expose whether a batch is still tagging, ready for review, or terminal

Record sketch:

```yaml
upload_batch_sessions:
  id: uuid
  user_id: uuid
  status: text
  total_count: int
  uploaded_count: int
  processed_count: int
  awaiting_verification_count: int
  verified_count: int
  failed_count: int
  created_at: timestamptz
  completed_at: timestamptz?
```

Notes:
- this is operational state, not the final wardrobe truth
- review now intentionally unlocks only when the full batch is ready instead of when a single item finishes first

### 5. `public.upload_batch_items`

Product meaning:
- one uploaded image within a batch session

Primary responsibilities:
- preserve per-file processing state
- bridge an uploaded photo to the eventual trusted `clothing_items` row

Record sketch:

```yaml
upload_batch_items:
  id: uuid
  session_id: uuid
  user_id: uuid
  file_name: text
  image_url: text
  thumbnail_url: text?
  cutout_url: text?
  status: text
  error_message: text?
  clothing_item_id: uuid?
  verified_at: timestamptz?
  created_at: timestamptz
```

Notes:
- this table decouples “uploaded and being reviewed” from “trusted wardrobe item”
- rejected batch rows can exist without ever becoming part of the final wardrobe

### 6. `public.events`

Product meaning:
- a parsed occasion request from the user

Primary responsibilities:
- preserve the user’s original event description
- persist normalized occasion context for recommendation scoring

Record sketch:

```yaml
events:
  id: uuid
  user_id: uuid
  raw_text: text
  occasion_type: text
  formality_level: float?
  temperature_context: text?
  setting: text?
  created_at: timestamptz
```

### 7. `public.outfit_suggestions`

Product meaning:
- one scored outfit recommendation associated with one user and one event

Primary responsibilities:
- preserve the actual item combination
- store score, explanation, rating, and structured summary card

Record sketch:

```yaml
outfit_suggestions:
  id: uuid
  user_id: uuid
  event_id: uuid
  item_ids: uuid[]
  accessory_ids: uuid[]
  score: float?
  explanation: text?
  user_rating: int?
  card: jsonb?
  generated_at: timestamptz
```

Notes:
- `card` is a migration-added structured summary used by Event, Archive, and Style Item
- `item_ids` contains the core garments
- `accessory_ids` contains attached finishing pieces, including accessories and jewelry
- rating is combo-level feedback, not per-item feedback

### 8. `public.style_direction_feedback`

Product meaning:
- one persisted usefulness vote on a `Beyond your wardrobe` option

Primary responsibilities:
- retain user thumbs up/down sentiment on AI editorial options
- let regenerated style-direction results preserve prior usefulness feedback for the same event

Record sketch:

```yaml
style_direction_feedback:
  id: uuid
  user_id: uuid
  event_id: uuid
  option_name: text
  feedback_value: text
  option_snapshot: jsonb
  created_at: timestamptz
  updated_at: timestamptz
```

Notes:
- this is intentionally separate from `outfit_suggestions.user_rating`
- wardrobe outfit ratings and editorial usefulness votes are different feedback channels

### 9. `public.style_taxonomy`

Product meaning:
- the DB-resident fashion vocabulary registry

Primary responsibilities:
- descriptor vocabularies
- CLIP label prompts
- color mappings
- body-type preference vocab
- event token vocabulary

Record sketch:

```yaml
style_taxonomy:
  id: bigint
  domain: text
  category: text
  attribute: text
  value: text
  meta: jsonb
  sort_order: int
  is_active: boolean
  created_at: timestamptz
  updated_at: timestamptz
```

Notes:
- this is closer to a controlled vocabulary / configuration table than a transactional table
- it feeds tagging, scoring, and vocabulary resolution throughout the app

### 10. `public.style_catalog`

Product meaning:
- the canonical style-signal catalog used for Discover preference learning

Primary responsibilities:
- define style IDs/keys used by Discover interactions and learned preferences

Record sketch:

```yaml
style_catalog:
  id: uuid
  style_key: text
  label: text
  dimension: text
  description: text?
  aliases: jsonb
  sort_order: int
  is_active: boolean
  created_at: timestamptz
  updated_at: timestamptz
```

Difference from `style_taxonomy`:
- `style_taxonomy` is broad fashion vocabulary/configuration
- `style_catalog` is the curated style-signal set used by Discover learning

### 11. `public.discover_candidates`

Product meaning:
- per-user cached Discover candidates before or after analysis

Primary responsibilities:
- store source results from Pexels/mock provider
- persist analysis outcome
- act as the warm cache for the Discover feed

Record sketch:

```yaml
discover_candidates:
  id: uuid
  user_id: uuid
  normalized_url: text
  source_url: text
  image_url: text
  thumbnail_url: text?
  source_domain: text?
  provider_name: text?
  title: text
  summary: text?
  source_note: text?
  search_query: text?
  status: text
  analysis: jsonb
  style_tags: text[]
  style_ids: text[]
  person_count: int
  is_single_person: boolean
  last_error: text?
  last_analyzed_at: timestamptz?
  created_at: timestamptz
  updated_at: timestamptz
```

Status model:
- `queued`
- `ready`
- `filtered`
- `failed`

Important current behavior:
- analysis is versioned so stale cached Discover cards can be invalidated after classifier logic changes
- style-tag extraction now uses focused outfit crops plus conservative pattern fallbacks

### 12. `public.discover_style_interactions`

Product meaning:
- the immutable swipe log for Discover

Primary responsibilities:
- preserve every `love`, `like`, and `dislike`
- store the exact card/style snapshot that was shown
- serve as the evidence source for learned preferences

Record sketch:

```yaml
discover_style_interactions:
  id: uuid
  user_id: uuid
  card_id: text
  source_url: text
  normalized_url: text
  image_url: text
  thumbnail_url: text?
  source_domain: text?
  title: text
  summary: text?
  search_query: text?
  style_ids: text[]
  style_tags: text[]
  action: text
  person_count: int
  is_single_person: boolean
  analysis: jsonb
  interaction_index: int?
  created_at: timestamptz
```

This is the source of truth for:
- total Discover interaction count
- local-day quota count
- later preference recomputes

### 13. `public.discover_ignored_urls`

Product meaning:
- per-user exclusion registry for Discover links

Primary responsibilities:
- prevent already-acted-on links from recycling back into the feed

Record sketch:

```yaml
discover_ignored_urls:
  id: uuid
  user_id: uuid
  source_url: text
  normalized_url: text
  image_url: text?
  thumbnail_url: text?
  source_domain: text?
  search_query: text?
  last_action: text?
  reason: text?
  last_seen_at: timestamptz
  created_at: timestamptz
```

Important current behavior:
- user-facing excluded counts should reflect actual swiped/ignored links
- being merely shown in the feed should not permanently exclude a card

### 14. `public.user_style_preferences`

Product meaning:
- the derived, user-specific style profile computed from Discover history

Primary responsibilities:
- aggregate evidence per style signal
- expose which signals are preferred, disliked, or still emerging

Record sketch:

```yaml
user_style_preferences:
  id: uuid
  user_id: uuid
  style_id: text
  style_key: text
  label: text
  dimension: text
  score: float
  confidence: float
  exposure_count: int
  love_count: int
  like_count: int
  dislike_count: int
  positive_count: int
  negative_count: int
  status: text
  last_interaction_at: timestamptz?
  updated_at: timestamptz
  created_at: timestamptz
```

This table is:
- derived
- rebuildable from `discover_style_interactions`
- intentionally separate from `users`

### 15. `public.discover_jobs`

Product meaning:
- the durable background job queue for Discover

Primary responsibilities:
- warm candidate pools
- recompute user style preferences
- support retries, dedupe, and worker recovery

Record sketch:

```yaml
discover_jobs:
  id: uuid
  user_id: uuid
  job_type: text
  status: text
  priority: int
  payload: jsonb
  dedupe_key: text?
  attempts: int
  max_attempts: int
  scheduled_for: timestamptz
  locked_at: timestamptz?
  locked_by: text?
  last_error: text?
  result: jsonb?
  created_at: timestamptz
  updated_at: timestamptz
```

Typical job types:
- `seed_discover_candidates`
- `refresh_style_preferences`

### 16. `public.discover_user_state`

Product meaning:
- per-user Discover active-day and recent-family serving state

Primary responsibilities:
- track total Discover interactions
- preserve recent-family spacing across refreshes
- allow cooldown logic to run on actual Discover usage days instead of plain wall-clock time

Record sketch:

```yaml
discover_user_state:
  id: uuid
  user_id: uuid
  total_interactions: int
  recent_family_keys: text[]
  last_discover_at: timestamptz?
  updated_at: timestamptz
  created_at: timestamptz
```

### 17. `public.discover_family_memory`

Product meaning:
- per-user memory row for one learned visual family

Primary responsibilities:
- cooldown enforcement
- short-term same-day follow-up memory
- reducing repeated same-type cards in Discover

Record sketch:

```yaml
discover_family_memory:
  id: uuid
  user_id: uuid
  family_key: text
  family_label: text?
  cooldown_until_active_day: int
  last_discover_active_at: timestamptz?
  updated_at: timestamptz
  created_at: timestamptz
```

### 18. `public.user_page_visits`

Product meaning:
- one route-level first-party page-visit record

Primary responsibilities:
- track product-surface entry/exit without clickstream-style replay

Record sketch:

```yaml
user_page_visits:
  id: uuid
  user_id: uuid
  page_name: text
  entered_at: timestamptz
  left_at: timestamptz?
  duration_ms: int?
  updated_at: timestamptz
  created_at: timestamptz
```

## Derived vs Source-of-Truth Tables

### Primary source-of-truth tables
- `users`
- `clothing_items`
- `upload_batch_sessions`
- `upload_batch_items`
- `events`
- `outfit_suggestions`
- `style_direction_feedback`
- `discover_style_interactions`
- `user_page_visits`

### Controlled vocabulary / configuration tables
- `style_taxonomy`
- `style_catalog`

### Derived / cache / operational tables
- `discover_candidates`
- `discover_ignored_urls`
- `user_style_preferences`
- `discover_jobs`
- `discover_user_state`
- `discover_family_memory`

## Storage Buckets

The current Supabase storage model complements the relational schema:

- `clothing-images` (private)
  - original wardrobe uploads
  - derived thumbnails
  - derived cutouts
- `profile-photos` (public)
  - user-visible avatar/profile image
- `ai-profile-photos` (public)
  - dedicated AI profiling image

These buckets are referenced by URL fields in `clothing_items` and `users`; they are not represented as relational tables in the app schema.

## Practical Reading Guide

If you are debugging or extending a feature, start here:

- `Wardrobe upload/edit/archive`
  - `users`
  - `clothing_items`
  - storage buckets

- `Event generation and Archive history`
  - `events`
  - `outfit_suggestions`
  - `style_direction_feedback`
  - `clothing_items`

- `Discover`
  - `discover_candidates`
  - `discover_style_interactions`
  - `discover_ignored_urls`
  - `user_style_preferences`
  - `discover_jobs`
  - `discover_user_state`
  - `discover_family_memory`
  - `style_catalog`

- `Batch Upload and verification`
  - `upload_batch_sessions`
  - `upload_batch_items`
  - `clothing_items`

- `Route-level activity`
  - `user_page_visits`

- `Vocabulary / tagging / scoring behavior`
  - `style_taxonomy`
  - `style_catalog`

## Current Design Intent

The overall model aims to keep:
- user identity/profile clean
- wardrobe items durable, media-aware, and optionally brand-tagged
- batch intake state explicit before wardrobe trust is granted
- recommendation history explicit
- editorial usefulness feedback separate from wardrobe outfit ratings
- Discover learning explainable and rebuildable
- style vocabularies configurable without hard-coding everything in app logic

That separation is one of the key architectural choices in the current version of LuxeLook AI.
