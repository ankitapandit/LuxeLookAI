# Changelog

All notable changes to LuxeLook AI are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## Version Summary

| Version | Date       | Description                                                  |
|---------|------------|--------------------------------------------------------------|
| 1.0.0   | 2026-03-16 | Initial upload — base codebase                               |
| 1.1.0   | 2026-03-16 | Development environment and dependency fixes                 |
| 1.2.0   | 2026-03-24 | Real mode support, UI overhaul, occasion/outfit improvements |
| 1.3.0   | 2026-03-24 | Supabase migrations file                                     |
| 1.4.0   | 2026-03-25 | User profile page and personalization foundations            |
| 1.5.0   | 2026-03-25 | Clothing descriptors, duplicate detection, wardrobe hygiene  |
| 1.6.0   | 2026-03-27 | Descriptor overhaul, outfit templates, UX fixes              |
| 1.7.0   | 2026-03-30 | Scorer intelligence, outfit feedback loop, Editorial Dark theme |

---

## [1.7.0] - 2026-03-30

### Added

#### Scorer Intelligence (Phase 1)
- `coherence` scoring component added to the hybrid recommender — 12 % weight,
  combines pattern mixing penalty (0 patterns=1.0, 1=0.85, 2=0.55, 3+=0.25)
  with fit consistency ratio (oversized vs fitted conflict penalty);
  contributes 60 % pattern + 40 % fit to the final coherence score
- HSL-based perceptual color scoring replaces name-lookup distance matching —
  `_rgb_to_hsl()` converts stored RGB to HSL; hue-wheel scoring: complementary
  (~180 °) = 0.90, analogous (< 45 °) = 0.80, monochromatic (< 15 °) = 0.85;
  neutral detection (saturation < 0.15) shortcuts to 1.0 / 0.95; `COLOR_RGB`
  dict extended to 30 canonical color → RGB mappings
- Body-type silhouette priors via `BODY_TYPE_PREFERENCES` dict covering
  hourglass, rectangle, pear, apple, inverted triangle and petite body types;
  `score_body_type_fit()` checks descriptor attributes (`fit`, `neckline`,
  `leg_opening`, `length`) against preferred values and returns
  `0.5 + 0.5 * (match_count / check_count)`; plugged into `score_outfit()` as
  the `preference` component when `user_body_type` is present in the request
- Recommender weights rebalanced to sum exactly 1.00:
  `color=0.18, formality=0.18, season=0.12, embedding=0.28, preference=0.12, coherence=0.12`
  (embedding raised 0.15→0.28, season reduced 0.30→0.12, coherence new)
- `SEEN_PENALTY = 0.70` constant — previously shown combos are downranked by
  30 % rather than excluded, preserving them as fallbacks when the wardrobe is
  small; applied in `generate_outfit_suggestions()` against `seen_combo_keys`

#### Outfit Rating & Feedback Loop
- Combo-level reputation replaces individual item reputation — feedback is keyed
  by `"|".join(sorted(item_ids))` (the combo key) scoped to an occasion context,
  preventing good items from being penalised for bad pairings
- `event_tokens` occasion context — LLM extracts semantic tags at parse time
  (e.g. dinner, interview, rooftop, evening); stored as `jsonb` on the `events`
  table; used to scope feedback across similar occasions without a new table
- `_occasion_similarity()` helper in recommendations.py — hard-filters on
  `occasion_type` mismatch or formality gap > 0.25; soft-scores via weighted
  Jaccard on `event_tokens` (activity tokens weight 3.0, setting 2.0, other 1.0)
  plus formality proximity and temperature match
- `_load_combo_feedback_weights()` — joins `outfit_suggestions` with `events`,
  gates rows by occasion similarity, returns `{combo_key: avg_weighted_score}`
  for the current session
- `RATING_TO_WEIGHT` dict: `{0: 0.10, 1: 0.20, 2: 0.40, 3: 0.60, 4: 0.80, 5: 1.00}`
- Session-level seen-ID accumulation — `allShownIds` state in events.tsx grows
  across every regenerate call in the same session; passed to the backend as
  `seen_combo_keys` so previously viewed outfits are consistently downranked
- `all_seen` flag returned from `generate_outfit_suggestions()` as
  `Tuple[List[Dict], bool]` — `True` when every returned outfit was previously
  shown; surfaced via `OutfitsResponse.all_seen` in the API response
- Two-button regenerate UX replacing a single "Regenerate" button:
  - **"Show me more"** — neutral regenerate, no negative signal recorded
  - **"None of these work ⓘ"** — explicit negative, marks current batch with
    `mark_as_bad: True`; tooltip on hover/focus explaining the scoring effect
- Exhaustion detection banner — shown when `all_seen=true`; displays message
  and a **"Reset & start fresh"** action button
- `POST /recommend/reset-feedback` endpoint — accepts `event_id`, finds all
  events with matching `occasion_type` + formality band, sets `user_rating=NULL`
  on their outfit suggestions; `handleReset()` in events.tsx calls this then
  clears `allShownIds` and re-generates
- `_mark_skipped_suggestions()` only fires when `mark_as_bad=True`, not on
  every regenerate — avoids false negatives on neutral browsing
- `ResetFeedbackRequest` Pydantic schema with `event_id: str`
- `GenerateOutfitsRequest` extended with `mark_as_bad: bool = False`
- `resetFeedback(eventId)` API function in frontend/services/api.ts
- `_ACTIVITY_TOKENS`, `_SETTING_TOKENS` sets in recommendations.py for
  weighted Jaccard token classification
- `_mock_parse_occasion()` extended with `_ACTIVITY_MAP`, `_SETTING_MAP`,
  `_SOCIAL_MAP` keyword extraction — returns `event_tokens: List[str]`
- `_real_parse_occasion()` prompt updated to request `event_tokens` JSON field
- `event_tokens` persisted in `_create_event_mock()` and `_create_event_real()`
- `Event` schema and TypeScript interface updated with `event_tokens` field
- `event_tokens jsonb default '[]'` column added to `events` table in
  `supabase_migrations.sql`

#### Editorial Dark Theme
- Full design-system overhaul from cream/charcoal light theme to an
  Editorial Dark palette — inspired by high-fashion editorial photography
- New CSS token set in globals.css:
  `--cream: #0E0D0B` (page bg), `--surface: #181714` (card bg),
  `--surface-alt: #111009` (auth panel), `--input-bg: #1C1A14`,
  `--charcoal: #F0EBE2` (primary text), `--ink: #F0EBE2`,
  `--muted: #9E9C98` (secondary text, WCAG AA verified),
  `--gold: #D4A96A`, `--gold-light: #E8C48A`, `--gold-hover: #C49658`,
  `--border: #2A2620`
- WCAG 2.1 AA contrast audit performed before rollout — `#6B6760` muted
  text candidate failed at 3.45:1 on all dark backgrounds; fixed to
  `#9E9C98` achieving 7.09:1 on `#0E0D0B` and 6.95:1 on `#181714`
- Theme applied across 7 files: globals.css, Navbar.tsx, index.tsx,
  _app.tsx, wardrobe.tsx, profile.tsx, events.tsx
- `.btn-primary` updated: amber gold fill (`var(--gold)`) + dark text `#0A0908`
- `.input` updated: dark input background with amber focus ring
- `.card` updated: `var(--surface)` background and dark shadow
- `prefers-reduced-motion` media query added to globals.css
- Warning boxes use amber rgba tints; pattern/descriptor pills use
  gold/surface palette; modal backgrounds use `var(--surface)`
- `theme-preview.html` interactive switcher (6 themes, full landing page
  render, JS `setTheme()`) retained as design reference

#### Landing Page Copy
- Hero section copy rewritten from technical feature-spec language to
  desire-first, outcome-led customer messaging — opens with the pain point
  ("stop staring at a full wardrobe feeling like you have nothing to wear"),
  bullet points describe the experience not the tech stack
- Feature bullets replaced with `✦` gold diamond markers matching the
  editorial dark aesthetic; technical acronyms (CLIP, LLM, embeddings)
  removed from all customer-facing copy

### Changed
- `generate_outfit_suggestions()` return type changed from `List[Dict]` to
  `Tuple[List[Dict], bool]` — callers must unpack `suggestions, all_seen`
- `score_outfit()` accepts new `user_body_type: Optional[str]` parameter;
  `preference` component uses body-type prior when body type is known,
  falls back to combo feedback weight otherwise
- `POST /recommend/generate-outfits` step 2 is now conditional on
  `mark_as_bad` — neutral "Show me more" no longer writes negative ratings
- `_load_seen_combos()` now returns a set of combo keys across the full
  user × occasion scope, not just the last event

### Schema Changes (Supabase)
- `events` table: `event_tokens jsonb default '[]'` column added
- No new tables introduced — star schema maintained with
  `outfit_suggestions` as fact table; feedback scoping handled in
  application code via occasion similarity

---

## [1.6.0] - 2026-03-27

### Added
- Four outfit templates in recommender — engine now builds candidates across
  top+bottom+shoes, top+bottom+outerwear+shoes, dress+shoes, and
  dress+outerwear+shoes; selects the highest-scoring outfit per template first,
  then fills remaining slots with overflow combos ranked by score; previously
  outerwear was never included in any generated suggestion
- Hemline descriptor attribute for tops, dresses and outerwear —
  straight, curved, asymmetrical, high-low, peplum, ruffle hem
- Strap Type descriptor for tops and dresses —
  strapless, spaghetti, wide, adjustable, racerback, cross-back, halter;
  spaghetti strap moved here from neckline
- Detailing descriptor for tops, dresses and outerwear —
  ruffles, pleats, ruched, smocked, tiered, draped, cut-out, slit, bow,
  knot, lace-up, fringe, embroidery; replaces the generic embellishment field
- Insulation and weather_resistance descriptor attributes for outerwear only
- Distressing descriptor for bottoms — clean, distressed, ripped, frayed, washed
- Leg Opening attribute for bottoms replacing the previous silhouette field —
  skinny, straight, wide, flare, bootcut, tapered, barrel
- Accessory closure attribute — zipper, magnetic, snap, drawstring
- Accessory strap_type attribute — top handle, crossbody, shoulder, chain

### Changed
- CATEGORY_DESCRIPTORS fully overhauled in both llm.py and wardrobe.tsx aligned
  to a consolidated fashion taxonomy cross-referenced against WGSN, Zara, SSENSE,
  Revolve, Fashionpedia and Pinterest style guides:
  - Fabric lists trimmed to 14 canonical materials consistent across sources;
    elastane, velvet, jersey, tulle, organza, cashmere removed
  - Neckline aligned: asymmetrical added; spaghetti strap moved to strap_type;
    one-shoulder and bardot removed
  - Shoe descriptor shoe_style renamed to shoe_type
  - Heel types rationalised to 8 categories: stiletto, block, wedge, kitten,
    cone, spool, chunky, sculptural
  - Shoe ankle_height removed (covered by shoe_type values)
  - Bottom waistband and rise collapsed into waist_structure and waist_position
  - COMMON_DESCRIPTORS emptied — all attributes now explicitly per-category
- _mock_describe_clothing() updated to match new descriptor schema for all
  categories (tops, dresses, outerwear, bottoms, shoes)
- Events page UX collapsed from two steps into one — "Generate Outfit
  Suggestions" button now parses the occasion and generates outfits in a single
  backend flow; the intermediate "Occasion Parsed" card showing occasion type,
  formality, setting and temperature is no longer displayed to the user
- Wardrobe item edit tags now opens as a centred modal popup with backdrop
  instead of stretching inline below the card
- Wardrobe item delete now shows an inline confirmation overlay on the card
  before removing; previously deleted immediately on click
- README Recommendation Engine section updated to document the four outfit
  templates and updated First Run steps

### Fixed
- PATCH /clothing/item/{id} returning 404 on valid items — supabase-py v2
  requires .select() chained after .update() to return the updated row;
  without it result.data was always [], causing correct_item_tags() to return
  None and the route to raise 404
- Stale setStep and setParsedEvent references in events.tsx textarea onChange
  and example prompt onClick handlers left over from the two-step refactor —
  replaced with setEventId and setSuggestions resets

---

## [1.5.0] - 2026-03-25

### Added
- Clothing descriptor system — per-category attributes covering fabric, neckline,
  sleeve length, sleeve style, fit, length, closure, back style, elasticity,
  sheer and pattern for tops, dresses and outerwear; waist position, waist
  structure, fit, leg opening, length, elasticity and pattern for bottoms;
  shoe type, toe shape, heel height, heel type, closure, fit and material for
  shoes; type, size, material and style for accessories
- describe_clothing() in ml/llm.py — GPT-4o Vision analyses an uploaded photo
  and returns a descriptor dict keyed by the category's attribute set;
  best-effort, never blocks upload on failure
- CATEGORY_DESCRIPTORS dict in ml/llm.py defining valid values per attribute per
  category; mirrored as a TypeScript const in wardrobe.tsx — both layers kept in
  sync as single sources of truth per tier
- COMMON_DESCRIPTORS dict (fabric_feel, embellishment) merged into allDescriptors
  alongside category-specific keys in the review and edit flows
- tag_clothing_item() now calls describe_clothing() after CLIP tagging in real
  mode; in mock mode calls _mock_describe_clothing() to populate deterministic
  fixture data; _fallback_tags() includes empty descriptors dict so the key is
  always present on the return value
- descriptors field added to ClothingItemCreate and ClothingItem Pydantic schemas
  in models/schemas.py
- descriptors and duplicate fields added to TypeScript TagPreview interface;
  descriptors added to ClothingItem interface, uploadClothingItem overrides and
  correctItem corrections in frontend/services/api.ts
- StyleDetailsSection component in wardrobe.tsx — shows AI-detected descriptor
  tags as filled chips in the review and edit panels; clicking a chip opens an
  inline option picker for that group; "+ Add detail" accordion lists all empty
  groups for the selected category
- Descriptor tags rendered on wardrobe item cards below season and formality pills
- Duplicate photo detection in tag_preview — generates CLIP embedding of incoming
  image, compares via cosine similarity against all existing user items
  (threshold 0.95); colour-aware: candidates whose stored colour differs from the
  new item's detected colour are skipped, so the same cut in a different colour
  (e.g. blue jeans vs black jeans) is not flagged
- find_duplicate() in clothing_service.py implementing the above; queries
  embedding_vector column explicitly to work around pgvector exclusion from
  Supabase select("*"); returns id, category, color, image_url and score of
  the best match, or None if below threshold
- DUPLICATE_THRESHOLD = 0.95 constant in clothing_service.py
- Side-by-side duplicate comparison panel in wardrobe review flow — shows new
  photo alongside existing matched photo with similarity percentage;
  "Replace existing" deletes the old item before saving, "Keep both" proceeds
  with no deletion
- Storage cleanup on item delete — _delete_item_real() fetches image_url before
  row deletion, extracts the storage path from the URL, removes the object from
  the clothing-images bucket; failure is non-blocking (logged, does not abort)
- descriptors jsonb column on clothing_items table (default '{}') in
  supabase_migrations.sql
- updated_at timestamptz column on clothing_items with default now() and
  auto-update trigger set_updated_at() that fires before every row update
- deleted_at and is_active columns added to clothing_items for future soft-delete
  support (hard delete is still used; columns present for migration continuity)
- PhotoCropper component (frontend/components/PhotoCropper.tsx) — modal canvas
  cropper with circular crop area, pan by dragging, zoom via scroll wheel or
  pinch, +/− buttons and a range slider; exports a cropped JPEG blob for upload
- Profile photo upload now intercepts the file input, opens the PhotoCropper
  modal for crop and zoom adjustment, then uploads the resulting blob instead
  of the raw file; handleCropComplete() manages the upload, preview, face shape
  response handling and error rollback

### Changed
- tag_preview endpoint now calls find_duplicate() and describe_clothing() and
  returns descriptors and duplicate in the response alongside existing fields
- _user_id parameter in tag_preview renamed to user_id — was previously unused
  but is now required for duplicate detection across the user's wardrobe
- _get_items_real() changed from select("*") to select("*, embedding_vector") —
  pgvector columns are excluded from the wildcard select in Supabase, causing
  embedding_vector to silently return null; explicit column name fixes this for
  the wardrobe fetch used in recommendations
- descriptors field persisted in _upload_mock() and _upload_real() row dicts so
  the column is populated on every new upload path
- Occasion removed from wardrobe descriptor set — occasion context is determined
  at event time by the LLM and is not stored as a static clothing attribute

### Fixed
- pgvector embedding_vector column not returned by Supabase select("*") —
  fixed by selecting the column explicitly in both _get_items_real() and
  find_duplicate(); previously embedding_vector was always null in real mode,
  making embedding similarity scores meaningless in the recommender
- TOKENIZERS_PARALLELISM fork-safety warning logged on every backend startup —
  suppressed by setting TOKENIZERS_PARALLELISM=false in backend/.env;
  config.py updated with model_config extra="ignore" to allow the extra env var
- TS2802 set is not iterable error in wardrobe.tsx eyedropper canvas pixel read —
  replaced destructuring of ImageData with explicit index access [0],[1],[2]
- TS2353 Object literal may only specify known properties — descriptors was not
  in the uploadClothingItem overrides type; added to both uploadClothingItem and
  correctItem in api.ts

### Deferred
- Soft delete query filter — is_active and deleted_at columns are present in the
  schema but get_user_items() does not yet filter by is_active; deferred until
  the full soft-delete flow (restore UI, audit log) is implemented
- Duplicate detection in mock mode — skipped because mock embeddings are random
  hashes and would produce meaningless similarity scores

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
