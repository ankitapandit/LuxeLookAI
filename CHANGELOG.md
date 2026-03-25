# Changelog

All notable changes to LuxeLook AI are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## Version Summary

| Version | Date       | Description                                              	  |
|---------|------------|--------------------------------------------------------------|
| 1.0.0   | 2026-03-16 | Initial upload — base codebase                           	  |
| 1.1.0   | 2026-03-16 | Development environment and dependency fixes             	  |
| 1.2.0   | 2026-03-24 | Real mode support, UI overhaul, occasion/outfit improvements |
| 1.3.0   | 2026-03-24 | Supabase migrations file					              	  |
| 1.4.0   | 2026-03-25 | User profile page and personalization foundations            |
| 1.5.0   | TBD        | Next release                                                 |

---

## [1.4.0] - 2026-03-25

### Added
- User profile page (/profile) with full personalization form
- GET /profile and PUT /profile backend endpoints with mock and real Supabase paths
- POST /profile/photo endpoint — uploads to profile-photos Supabase Storage bucket,
  triggers GPT-4o Vision face shape detection, cleans up old photos before upload
- Profile link added to Navbar
- UserProfile and UpdateProfileRequest Pydantic schemas
- photo_url and face_shape columns added to users table
- getProfile() and updateProfile() API functions in frontend
- Body type inline calculator — bust/waist/hip inputs with scored matching,
  top-2 results shown on borderline cases with confidence note
- Complexion inline guide — 3-question identifier (vein color, sun reaction,
  skin depth) with scored matching and slash notation for ambiguous results
  e.g. "medium / olive"
- Face shape auto-detection via GPT-4o Vision on profile photo upload —
  auto-fills field on high confidence, shows review banner on medium confidence,
  prompts manual tool on low confidence / no face detected
- FaceShapeTool component — canvas-based landmark tool, user places 8 numbered
  points on their photo (top, temples, cheeks, jaw corners, chin), side-by-side
  reference diagram, drag to reposition points, calculates shape from geometry
- PhotoCropper component — modal canvas cropper with circular crop area,
  pan by dragging, zoom via scroll wheel or +/- buttons with slider,
  exports cropped blob before upload
- Height field with cm / in unit toggle — converts on switch, stores cm
- Weight field with kg / lbs unit toggle — converts on switch, stores kg
- Hairstyle split into two categories: texture (straight/wavy/curly/coily)
  and length (short/medium/long), each independently selectable, stored as
  comma-separated string e.g. "wavy, long"
- Body type, complexion and face shape collapsible guide charts
- Height and weight range validation before save (50–250cm, 20–300kg)
- Unit preference persisted in localStorage across sessions
- profile-photos Supabase Storage bucket with RLS policies for upload,
  update, delete and service role access
- detect_face_shape() function in ml/llm.py using GPT-4o Vision

### Changed
- height and weight columns renamed to height_cm and weight_kg in users table
  for clarity — trickled through schemas, API types and profile page
- Profile photo upload now shows PhotoCropper modal before uploading —
  user adjusts crop and zoom, cropped blob is uploaded instead of raw file
- Old profile photos deleted from storage before each new upload
- Face shape field populated automatically from photo upload when confidence
  is sufficient, otherwise prompts user to use landmark tool

### Fixed
- Storage upload failing due to wrong bucket name reference
- Profile photo not loading in FaceShapeTool on page reload — fixed by
  fetching image as blob to avoid canvas CORS taint
- FaceShapeTool useEffect not firing when photoUrl set after mount — fixed
  by removing canvasRef dependency from effect condition
- Supabase storage upsert RLS failure — UPDATE policy missing with_check clause
- Old photos accumulating in bucket on re-upload — list + delete before upload

### Deferred
- favorite_photo_embedding — CLIP processing of profile photo for style matching
- PRO tier gating UI — all profile fields editable for now, lock/upgrade prompt
  deferred to future version when payment system is in place

---

## [1.3.0] - 2026-03-24

### Added
- supabase_migrations.sql — single file documenting every Supabase dashboard
  change across all versions: auth trigger, RLS policies, column additions,
  storage bucket setup. Safe to re-run on any environment.

---

## [1.2.0] - 2026-03-24

### Added
- Outfit history feed on Outfits page — all past events with suggestions, newest first
- Collapsible per-event sections with Hide / Show toggle, collapsed by default
- Timestamp on event date in outfit history
- Regenerate button per event in outfit history
- Events page is now fully self-contained — parses occasion and shows outfit
  suggestions inline without navigating away
- Horizontal carousel for outfit suggestions on both Events and Outfits pages
- Inline star ratings on Events page suggestions
- ImageEyedropper on wardrobe upload — click any pixel on the uploaded image
  to sample its exact color
- ColorPicker with preset swatches and custom hex input
- PatternPicker with 7 pattern types (stripes, plaid, floral, polka dots,
  animal print, geometric, abstract) each with SVG swatch preview
- Pattern field stored and returned on all clothing item operations
- GET /events/list endpoint — returns all user events newest first
- GET /recommend/suggestions/{event_id} — fetches previously generated suggestions
- Keyword-based mock occasion parser — replaces random hardcoded stubs
- Cycling loading messages during outfit generation
- on_auth_user_created trigger — auto-inserts into public.users on signup
- RLS policies for service role on all tables
- pattern column on clothing_items table

### Changed
- Wardrobe upload is now a two-step wizard: AI tag preview → user review → confirm
- Season and formality removed from review panel — AI-only, not shown to user
- Item cards display as "Category - Color name" instead of raw color key or hex
- Hex color values resolved to nearest named color using RGB distance matching
- Occasion parser persona changed to "expert fashion stylist"
- Occasion parsing prompt improved with venue, setting and formality nudge rules
- Recommender weights rebalanced: formality 0.35→0.25, season 0.25→0.30,
  user_preference 0.05→0.10
- Formality tolerance tightened 0.25→0.20
- Category-based formality floor prevents garments scoring unrealistically casual
- Outfits page filtered to only show events that have generated suggestions
- Real Supabase paths added to recommendations and feedback persistence
- users FK made deferrable to fix timing issues during signup

### Fixed
- Embedding vector stored as string in Supabase instead of list
- LLM responses wrapped in ```json markdown fences causing JSON parse errors
- Duplicate key error on repeated signup attempts
- public.users row not created on Supabase Auth signup

---

## [1.1.0] - 2026-03-16

### Added
- dev.sh startup script for one-command local development
- Automatic uv installation if not present (10-100x faster Python installs on macOS)
- Python 3.12 venv enforcement — auto-detects and recreates venv if wrong version
- Parallel backend and frontend launch with PID tracking
- dev.sh commands: setup / start / backend / frontend / stop / logs
- luxelook-activity.pdf — system architecture activity diagram

### Changed
- Next.js upgraded 14.2.3 → 15.1.7 for Node 25 and Apple Silicon compatibility
- React and react-dom upgraded to ^19.0.0
- lucide-react upgraded to ^0.460.0 for React 19 peer dependency support
- eslint upgraded to ^9 to satisfy Next 15 peer requirements
- dev script uses --turbopack for faster cold starts on Apple Silicon
- supabase-py pinned to >=2.10.0 for sb_publishable_ / sb_secret_ key format
- torch pinned to Python 3.12-compatible wheels
- README updated to reference dev.sh and document uv and Python version requirements

### Fixed
- macOS "Operation timed out" file read errors — xattr quarantine flag stripped on setup
- npm peer dependency conflicts — clean retry logic added to dev.sh setup
- images.domains deprecation warning replaced with images.remotePatterns

---

## [1.0.0] - 2026-03-16

### Added
- FastAPI backend with JWT authentication
- Mock auth mode — full app runs locally with no external services
- Mock AI mode — deterministic tags and embeddings, no API keys needed
- Clothing upload with CLIP-based auto-tagging (category, color, season, formality)
- CLIP 512-dim embedding generation and cosine similarity scoring
- Hybrid recommendation engine scoring outfits on color, formality, season,
  embedding similarity and user preference
- GPT-4o-mini occasion parsing from free-text input
- GPT-4o-mini outfit explanation generation
- Supabase Postgres schema with pgvector extension and RLS policies
- In-memory mock stores for auth and database (zero-dependency local dev)
- Next.js frontend with Playfair Display / DM Sans typography and
  cream/charcoal/gold design system
- Wardrobe management — upload, view, delete clothing items
- Events page — free-text occasion input with AI parsing
- Outfits page — ranked suggestions with score badge and star ratings
- Feedback system — 1-5 star ratings stored per outfit suggestion