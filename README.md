# LuxeLook AI 💎

> AI-powered personal stylist. Upload your wardrobe, learn your taste, style specific pieces, and get occasion-ready outfits.

Built with **Next.js · FastAPI · Supabase · CLIP · Pexels · OpenAI**.

Current user-facing sections are: **Wardrobe · Discover · Event · Archive · Profile · Guide**.
Supporting flows include **Style Item** (`/style-item`), the dedicated AI profiling photo path inside Profile, and the isolated **Event Scenario Tester** at `/test/event-scenarios`.
Legacy frontend URLs `/events` and `/outfits` permanently redirect to `/event` and `/archive`.
Sessions now restore on refresh, wardrobe uploads show live media-processing status, Discover learns from swipes without wiping learned rails, structured event briefs are stored as JSON + human summaries, `Beyond your wardrobe` renders as a visual moodboard, and refreshed outfit batches preserve saved ratings while avoiding exact duplicate looks.

For the current system reference, see [`docs/system-architecture.md`](/Users/anki/Desktop/Code/LuxeLookAI/luxelook-ai/docs/system-architecture.md).

---

## Architecture

```
luxelook-ai/
├── backend/                    # FastAPI Python API
│   ├── main.py                 # App entry point + CORS
│   ├── config.py               # Environment variable loading
│   ├── schema.sql              # Base schema — run first in Supabase SQL Editor
│   ├── supabase_migrations.sql # All post-schema migrations — run second
│   ├── routers/                # API route handlers
│   │   ├── auth.py             # POST /auth/signup, /auth/login
│   │   ├── clothing.py         # Wardrobe CRUD, pagination, trash restore, thumbnail backfill
│   │   ├── discover.py         # Discover feed, swipes, jobs, status
│   │   ├── event.py            # POST /event/create-event, GET /event/list
│   │   ├── recommendations.py  # POST /recommend/generate-outfits
│   │   ├── feedback.py         # POST /feedback/rate-outfit
│   │   └── profile.py          # GET/PUT /profile, POST /profile/photo, /profile/ai-photo
│   ├── services/               # Business logic layer
│   │   ├── recommender.py      # Core outfit scoring engine
│   │   ├── clothing_service.py # Upload, tag, embed, duplicate detection
│   │   ├── discover_service.py # Discover feed assembly + seeded context
│   │   ├── discover_search.py  # Pexels/mock provider normalization
│   │   ├── discover_jobs.py    # Durable Discover job queue helpers
│   │   ├── style_learning.py   # Swipe logging + learned style aggregation
│   │   ├── event_service.py    # Event creation and retrieval
│   │   └── style_images.py     # Visual image enrichment for style directions
│   ├── ml/                     # AI components
│   │   ├── embeddings.py       # CLIP embedding generation (mock + real)
│   │   ├── tagger.py           # CLIP zero-shot clothing attribute detection
│   │   └── llm.py              # Occasion parsing, outfit explanation,
│   │                           # face shape detection, clothing descriptors
│   ├── models/
│   │   └── schemas.py          # Pydantic request/response models
│   ├── utils/
│       ├── db.py               # Supabase client (service role)
│       ├── auth.py             # JWT create + verify
│       ├── mock_auth_store.py  # In-memory auth for local dev
│       └── mock_db_store.py    # In-memory database for local dev
│   └── workers/
│       └── discover_worker.py  # Embedded/standalone Discover background worker
│
└── frontend/                   # Next.js TypeScript app
    ├── pages/
    │   ├── index.tsx            # Landing + Auth (login/signup)
    │   ├── wardrobe.tsx         # Upload, tag, browse wardrobe
    │   ├── discover.tsx         # Swipe-based taste-learning feed
    │   ├── event.tsx            # Describe event → AI parses → outfit suggestions
    │   ├── archive.tsx          # View outfit history + rate suggestions
    │   ├── guide.tsx            # User-facing fashion terminology + profile guide
    │   ├── style-item.tsx       # Style around one chosen wardrobe item
    │   └── profile.tsx          # User profile, body type, face shape, photo
    ├── components/
    │   ├── layout/Navbar.tsx    # Top navigation
    │   ├── OutfitCard.tsx       # Shared outfit metric card
    │   ├── OutfitMoodboard.tsx  # Editorial outfit presentation board
    │   ├── StyleDirectionMoodboard.tsx # Visual board for non-wardrobe style directions
    │   ├── OutfitSuggestionCard.tsx # Shared suggestion wrapper + modal
    │   ├── FaceShapeTool.tsx    # Canvas landmark tool for face shape detection
    │   └── PhotoCropper.tsx     # Modal canvas cropper for profile photo
    ├── test/
    │   └── eventScenarios.ts    # Saved EventBrief JSON scenarios for tester route
    ├── hooks/
    │   └── useAuth.tsx          # Shared auth/session provider
    ├── services/
    │   └── api.ts               # All API calls (Axios + fetch)
    └── styles/
        └── globals.css          # LuxeLook design tokens + utility classes
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.10–3.12 | https://python.org |
| Node.js | 18+ | https://nodejs.org |
| uv | latest | recommended — see below |

### Recommended: install uv for fast Python installs

`uv` is a Rust-based pip replacement that is 10–100x faster on macOS.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

`./dev.sh setup` detects uv automatically and offers to install it if missing.
pip works as a fallback — everything works without uv, just slower.

> **Python 3.13+ users:** `torch` wheels only exist up to Python 3.12. `./dev.sh setup`
> with uv automatically uses Python 3.12 for the venv. Without uv, install 3.12 manually.

---

## Step 1 — Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run `backend/schema.sql` — creates base tables, indexes, RLS
3. Run `backend/supabase_migrations.sql` — applies all post-schema migrations
4. Go to **Storage → New bucket**:
   - Create `clothing-images` (private)
   - Create `profile-photos` (public)
   - Create `ai-profile-photos` (public)
5. Go to **Settings → API** and copy:
   - Project URL
   - anon public key
   - service_role key (keep secret — backend only)

---

## Step 2 — First-time setup

```bash
chmod +x dev.sh
./dev.sh setup
```

This creates the Python venv, installs all dependencies, and copies `.env` example files.

### Fill in environment variables

**`backend/.env`:**
```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
OPENAI_API_KEY=sk-your-key
PEXELS_API_KEY=your-pexels-key
DISCOVER_SEARCH_PROVIDER=pexels
DISCOVER_EMBEDDED_WORKER=true
JWT_SECRET=any-long-random-string
USE_MOCK_AUTH=true    # set false when Supabase is configured
USE_MOCK_AI=true      # set false when OpenAI + CLIP are ready
TOKENIZERS_PARALLELISM=false
```

**`frontend/.env.local`:**
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

## Step 3 — Start everything

```bash
./dev.sh
```

```
✓ Backend  → http://localhost:8000
✓ Frontend → http://localhost:3000
  API docs → http://localhost:8000/docs
  Logs     → ./dev.sh logs
  Stop     → ./dev.sh stop
```

| Command | Description |
|---|---|
| `./dev.sh setup` | First-time install |
| `./dev.sh` | Start backend + frontend |
| `./dev.sh backend` | Start backend only |
| `./dev.sh frontend` | Start frontend only |
| `./dev.sh stop` | Stop all services |
| `./dev.sh logs` | Show recent logs |

---

## Step 4 — First Run

1. **Sign up** on the landing page
2. **Upload wardrobe items** — drag and drop clothing photos
   - AI auto-tags category, color, season, formality
   - GPT-4o Vision identifies style descriptors (neckline, silhouette, fabric etc.)
   - Duplicate detection flags items that are visually identical
   - If a duplicate already exists, the review flow can now offer to replace the active copy, unarchive the archived copy, or force-add the new upload
   - Wardrobe uploads save immediately, then generate thumbnails / subject cutouts in the background
   - A compact activity tray shows per-item processing status while media is being generated
   - Wardrobe browsing uses infinite scroll and processed previews for better large-closet performance
   - Supported core categories now include `jumpsuits` and a separate `jewelry` category alongside tops, bottoms, dresses, outerwear, shoes, accessories, sets, swimwear, and loungewear
3. **Set up your profile** — body type, height, weight, complexion, face shape
   - Body type calculator from bust/waist/hip measurements
   - Complexion identifier from 3 questions
   - Gender and ethnicity can optionally be stored to improve Discover seeding later
   - Separate AI profiling photo suggests face shape, body type, complexion and hair traits
4. **Use Discover** — open **Discover / The Edit** to swipe fashion inspiration
   - Discover seeds a per-user search using profile context and learned style signals
   - Candidate images are cached, filtered to single-person looks, and analyzed before being shown
   - `like`, `love`, and `dislike` interactions build learned preference rows over time
   - Daily swipe pacing is enforced on the user’s local day while timestamps remain stored in UTC
5. **Create an event** — fill the structured occasion brief (dress code, venue, weather, mood, audience, notes)
   - The backend stores both a structured `raw_text_json` payload and a clean human-readable summary
   - Occasion parsing uses the structured brief as prompt context, which improves edge cases such as beach BBQ vs. beach wedding
   - All EventBrief form fields now contribute occasion tokens, and an explicit dress-code selection overrides weaker inferred formality
   - If you choose `Other`, the UI keeps and displays your custom text directly instead of reverting to a generic placeholder label
6. **Get outfit suggestions** — AI builds complete looks across 8 outfit templates
   (top+bottom+shoes, top+bottom+outerwear+shoes, dress+shoes, dress+outerwear+shoes,
   set+shoes, set+outerwear+shoes, swimwear+shoes, swimwear+outerwear+shoes).
   If the wardrobe is missing item types needed to unlock some templates, an
   **"Unlock more looks"** banner shows actionable hints below the suggestions. If
   a look reappears after refresh, its saved stars are preserved and shown again
   instead of resetting to unrated.
7. **Style a specific item** — from the wardrobe, go to **Style Item** to build looks around one selected piece
   - complete wardrobe-only outfits reuse the standard suggestion cards and the same structured brief editor as Event
   - the same custom `Other` behavior carries across, so bespoke occasion details stay visible as entered
   - incomplete wardrobes fall back to editorial styling guidance and missing-piece direction
   - `Beyond your wardrobe` now renders as a visual moodboard with wearable-piece imagery plus separate Hair / Makeup finishing chips
8. **Rate outfits** — 1–5 stars to improve future suggestions
9. **Regenerate** — "Show me more" for a neutral refresh; "None of these work" to
   signal the current batch was wrong; ratings are tracked per combo + occasion context
   so future events of the same type benefit from accumulated feedback. Exact
   duplicate outfit combos are filtered out on refresh so fresh options surface first.
10. **Reset** — if you've exhausted all combinations for an event a banner appears;
   "Reset & start fresh" clears combo ratings for that occasion context and starts fresh
11. **Use Guide** — open **Guide** to see the fashion vocabulary and profile explanation layer the app uses for tagging and recommendations
12. **Scenario-test events** — open `/test/event-scenarios` to run saved EventBrief JSON cases against the real Event recommendation flow without touching your main Event page

---

## Switching to Real AI

```env
OPENAI_API_KEY=sk-your-real-key
USE_MOCK_AI=false
USE_MOCK_AUTH=false
```

First run downloads the CLIP model (~1.7GB, cached locally afterwards).

**Approximate OpenAI costs:**
| Operation | Model | Cost |
|---|---|---|
| Occasion parsing | GPT-4o-mini | ~$0.001 per event |
| Outfit explanation | GPT-4o-mini | ~$0.002 per outfit |
| AI profiling analysis | GPT-4o | ~$0.02 per profiling photo |
| Clothing descriptors | GPT-4o | ~$0.02 per item upload |

---

## API Reference

Full interactive docs at [http://localhost:8000/docs](http://localhost:8000/docs).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/signup` | Create account |
| POST | `/auth/login` | Get JWT token |
| POST | `/clothing/tag-preview` | AI tag + descriptor preview (no save) |
| POST | `/clothing/upload-item` | Upload, tag, embed, save item, and queue media processing |
| GET | `/clothing/items` | List active wardrobe items |
| GET | `/clothing/items/page` | Paginated wardrobe slice with optional filters |
| GET | `/clothing/items/media-status` | Poll live media-processing status for active wardrobe items |
| PATCH | `/clothing/item/{id}` | Correct tags on saved item (category, color, season, formality, descriptors) |
| DELETE | `/clothing/item/{id}` | Soft-delete item (moves to trash, restorable) |
| GET | `/clothing/items/deleted` | List soft-deleted items (trash view) |
| POST | `/clothing/item/{id}/restore` | Restore a soft-deleted item (with duplicate guard) |
| POST | `/clothing/purge-deleted` | Hard-delete trash items older than 90 days |
| POST | `/clothing/backfill-thumbnails` | Generate thumbnails / cutouts for older active wardrobe items missing them |
| GET | `/clothing/tag-options` | Valid categories, colors for dropdowns |
| POST | `/event/create-event` | Create an event from the structured brief and readable summary |
| GET | `/event/list` | List all user events |
| POST | `/recommend/generate-outfits` | Generate outfit suggestions, preserving existing ratings for repeated combos |
| GET | `/recommend/suggestions/{event_id}` | Fetch saved suggestions (de-duped by outfit combo) |
| POST | `/recommend/reset-feedback` | Clear combo ratings for an occasion context |
| POST | `/feedback/rate-outfit` | Submit 1–5 star rating |
| POST | `/discover/prewarm` | Queue candidate warm-up for Discover |
| GET | `/discover/feed` | Build the Discover feed from cached/analyzed candidates |
| POST | `/discover/interaction` | Log a Discover `like` / `love` / `dislike` |
| POST | `/discover/recompute` | Rebuild learned Discover style preferences from stored history |
| GET | `/discover/status` | Fetch Discover totals, learned rows, and background status |
| GET | `/discover/jobs/{job_id}` | Poll one Discover background job |
| POST | `/discover/retry-seed` | Queue another Discover warm-up job |
| GET | `/profile` | Get user profile |
| PUT | `/profile` | Update profile fields |
| POST | `/profile/photo` | Upload cropped profile/avatar photo |
| POST | `/profile/ai-photo` | Upload AI profiling photo + analyze face/body/complexion/hair traits |

All routes except `/auth/*` require `Authorization: Bearer <token>` header.

---

## Supported Clothing Categories

| Category | Description | Outfit role |
|---|---|---|
| **tops** | T-shirts, blouses, shirts, sweaters | Core (upper body) |
| **bottoms** | Trousers, jeans, skirts, shorts | Core (lower body) |
| **dresses** | Dresses | Core (full body — templates C, D) |
| **jumpsuits** | Jumpsuits, rompers, playsuits | Core (full body styling piece) |
| **set** | Co-ord two-pieces (matching top + bottom sold together) | Core (full look — templates E, F) |
| **swimwear** | Bikinis, one-pieces, tankinis, monokinis, swim dresses | Core (beach/resort — templates G, H) |
| **loungewear** | Hoodies, joggers, pajama sets, robes, shorts sets | Casual/home only |
| **outerwear** | Coats, jackets, blazers, cardigans | Layering (templates B, D, F) |
| **shoes** | Heels, sneakers, boots, sandals, flats | Required in all templates |
| **accessories** | Handbags, belts, scarves, hats | Attached after core scoring (up to 2) |
| **jewelry** | Necklaces, earrings, bracelets, rings, watches, anklets, brooches, cuffs | Attached after core scoring (up to 2) |

Each category has a dedicated descriptor vocabulary extracted at upload time by GPT-4o Vision
and used for body-type matching and scoring. Descriptors can be edited per-item after upload
(individual keys are merged — unrelated fields are preserved).

Wardrobe cards prefer `thumbnail_url` when available and fall back to the original `image_url`.
New uploads generate thumbnails automatically, and older items can be upgraded through
`POST /clothing/backfill-thumbnails`.

| Category | Descriptor highlights |
|---|---|
| tops / bottoms / dresses | fabric, warmth, fit, neckline, sleeve length, strap type, back style, waist, hemline, pattern, detailing |
| **set** | fabric type, warmth, top style, bottom style, fit, pattern |
| **swimwear** | swimwear style, coverage level, cut, swim-specific fabric type |
| **loungewear** | Loungewear type, fabric, neckline, sleeve length, strap type, support, structure, waist structure, bottom length |
| outerwear / shoes / accessories | Category-specific vocabularies |

---

## Recommendation Engine

The engine judges an outfit as a **composed look**, not a sum of independent items.
Each outfit is scored against the specific user, event, and time context:

```
Score(u, e, o) = 0.28·C + 0.24·A + 0.22·P + 0.10·T + 0.08·N + 0.05·D − 0.03·R
```

| Symbol | Component | Weight | What it measures |
|---|---|---|---|
| **C** | Compatibility | 0.28 | How well items work together as a look |
| **A** | Appropriateness | 0.24 | How suitable the outfit is for the event |
| **P** | Preference | 0.22 | Alignment with the user's personal style |
| **T** | Trend | 0.10 | Trend relevance blended from seasonal calendar signals and predicted outfit attributes |
| **N** | Novelty | 0.08 | Freshness vs. recently shown outfit history |
| **D** | Diversity | 0.05 | Completeness bonus for covering expected outfit slots |
| **R** | Risk | 0.03 | Dress-code / confidence penalty (subtracted) |

Constants live in `backend/services/recommender.py` → `WEIGHTS_V2` and `RISK_WEIGHT`.

Previously shown combos are filtered out first on regenerate so refreshes stay
fresh. If the wardrobe is truly exhausted, the engine can still fall back to the
best remaining seen looks instead of returning nothing.

When a previously rated combo reappears in the Archive or a refreshed event batch,
its saved `user_rating` is carried forward so stars do not reset on repeat looks.

---

### C — Compatibility `score_compatibility()`

```
C = 0.30 · pairwise_avg + 0.30 · color_story + 0.25 · silhouette + 0.15 · pattern
```

**Pairwise score** — every item pair in the outfit is scored:
```
pairwise(i, j) = 0.60 · color_harmony(i, j) + 0.40 · formality_match(i, j)
```
`pairwise_avg` is the mean across all pairs.

**Color story** `classify_color_story()` — classifies the outfit palette as a composed story:

| Palette type | Condition | Score |
|---|---|---|
| Neutral base + single accent | ≥1 neutral, exactly 1 chromatic | 0.92 |
| All neutrals | No chromatic colors | 0.88 |
| Monochromatic | All items same color | 0.86 |
| Tonal / analogous | Max hue distance < 45° | 0.84 |
| Complementary contrast | Hue distance 150°–210° | 0.80 |
| Mixed | Unclassified combination | 0.70 |
| Clashing | Max hue distance > 220° | 0.58 |

RGB values are converted to HSL for hue-wheel analysis. Color → RGB mappings are in `COLOR_RGB`.

Neutrals (black, white, beige, grey, cream, ivory, tan, camel, khaki, charcoal, silver, brown)
are treated as saturation < 0.15 and pair with any color at full score.

**Silhouette balance** `score_silhouette_balance()` — classic proportion rule:

| Outcome | Condition | Score |
|---|---|---|
| Balanced | 1+ oversized + 1+ fitted piece | 0.95 |
| Consistent | All fitted, no oversized | 0.88 |
| Relaxed | 1 oversized, no fitted | 0.82 |
| Double volume risk | 2+ oversized pieces | 0.55 |
| Insufficient data | < 2 descriptor-tagged items | 0.75 |

Oversized fits: `oversized, relaxed, loose, boxy, slouchy, wide, wide-leg, flare, flared, bootcut, barrel, voluminous`
Fitted fits: `fitted, slim, skinny, bodycon, tailored, second-skin`

**Pattern coherence** — number of patterned items in the outfit:

| Patterned items | Score |
|---|---|
| 0 (all solid) | 1.00 |
| 1 (statement piece) | 0.85 |
| 2 (bold mix) | 0.55 |
| 3+ | 0.25 |

---

### A — Appropriateness `score_appropriateness_v2()`

```
A = 0.50 · formality_fit + 0.25 · season_fit + 0.25 · venue_fit
```

**Formality fit** — per-item distance from occasion formality target, averaged:
```
formality_fit(item) = max(0, 1 − (|item_formality − event_formality| − 0.25) / 0.75)
```
Tolerance band = 0.25 (scores 1.0 within the band, decays linearly outside).

**Season fit** — `"all"` season items always score 1.0; seasonal items matched against
`temperature_context` from the occasion (warm/cold/mild/cool).

**Venue fit** — derived from `event_tokens` parsed at occasion creation:
- Heels/stilettos at outdoor events (beach, rooftop, park, garden, hiking) → `× 0.80`
- Athletic/loungewear (formality < 0.25) at formal events (wedding, gala, cocktail, black-tie, interview) → `× 0.55`
- Swimwear outside beach/pool context → `× 0.30`
- Loungewear at formal events or occasion formality > 0.55 → `× 0.40`
- Beach / pool / resort context now also boosts swimwear, lighter fabrics, and beach-appropriate shoes while penalizing denim, heavy fabrics, closed-toe shoes, and overly structured silhouettes.

---

### P — Preference `score_body_type_fit()`

```
P = 0.5 · feedback_weight + 0.5 · body_type_score
```

`feedback_weight` is the occasion-scoped combo reputation (see Feedback Loop below).

`body_type_score` checks item descriptors against `BODY_TYPE_PREFERENCES` — a table
mapping `hourglass / rectangle / pear / apple / inverted triangle / petite` to preferred
`fit`, `neckline`, `leg_opening`, and `length` values:

```
body_type_score = 0.5 + 0.5 × (matched_descriptor_checks / total_descriptor_checks)
```

Returns 0.5 (neutral) when body type is unset or descriptor data is sparse.

*Planned v2.0: replace with a learned user style embedding trained on rated outfit history.*

---

### N — Novelty `score_novelty()`

```
N = 1 − max{ cosine_sim(outfit_emb, past_emb) : past_emb ∈ H }
```

Where `outfit_emb` is the mean of item CLIP embeddings in the current outfit, and
`H` is the set of past outfit embeddings reconstructed from `seen_item_combos`
(no extra DB query — item embeddings are already loaded). Cosine similarity is
normalised from [−1, 1] → [0, 1] before inversion.

Defaults to **0.80** (slightly below max) for new users with no history —
leaves room for the diversity signal.

---

### D — Diversity `score_diversity_completeness()`

Rewards outfits that cover the expected slots for the occasion formality:

| Completeness | Condition | Score |
|---|---|---|
| Complete layered look | core + shoes + outerwear (formality ≥ 0.4) | 0.95 |
| Complete look | core garment(s) + shoes | 0.85 |
| Missing footwear | core present, no shoes | 0.65 |
| Incomplete | Missing top/bottom/dress | 0.50 |

Core = (top + bottom) or (dress) or (set) or (swimwear).

A co-ord **set** covers both the top and bottom slot in a single item.
**Swimwear** is treated as a self-contained base garment.

---

### R — Risk Penalty `score_risk_penalty()`

Penalty subtracted from the composite score (capped at 0.50):

| Violation | Per-item penalty |
|---|---|
| Casual/athletic piece (formality < 0.20) at formal event | +0.25 |
| Swimwear outside beach/pool context | +0.35 |
| Loungewear at occasion formality > 0.40 | +0.20 |
| Over-dressed (formality > 0.90) at casual occasion | +0.12 |
| No descriptors and no color data | +0.04 |

Beach-specific penalties also apply when the venue indicates beach / pool / resort:
- Denim at the beach → `+0.12`
- Heavy fabrics (leather, suede, wool) at the beach → `+0.10`
- Closed-toe shoes at the beach → `+0.10`
- Formal / structured silhouettes at the beach → `+0.15`

---

### Outfit Templates

The engine builds candidates across four structural templates, scores every
combination, selects the top-ranked outfit from each template, then fills
remaining slots from the overflow pool:

| Template | Structure |
|---|---|
| A | top → bottom → shoes |
| B | top → bottom → outerwear → shoes |
| C | dress → shoes |
| D | dress → outerwear → shoes |
| E | set → shoes |
| F | set → outerwear → shoes |
| G | swimwear → shoes |
| H | swimwear → outerwear → shoes |

A **set** (co-ord two-piece) fills the top+bottom slot as a single item.
Templates G and H surface only when the occasion scores well for beach / pool / resort context.

Accessories (bags, belts, scarves etc.) are scored and attached after core
outfit scoring — up to 2 per outfit, deduplicated by subtype (no two bags).

---

### Outfit Feedback Loop

Ratings are tracked at **combo level** (the specific combination of item IDs),
not at individual item level — preventing good items being penalised for a bad
pairing. Combos are scoped to an occasion context using `occasion_type +
formality + event_tokens` similarity — so a "dinner date" rating influences
future dinner suggestions but not job interview outfits.

Occasion similarity uses **weighted Jaccard** on `event_tokens`:
- Activity tokens (dinner, interview, wedding…): weight **3.0**
- Setting tokens (rooftop, office, beach…): weight **2.0**
- Other tokens: weight **1.0**

Hard filter: `occasion_type` mismatch or formality gap > 0.25 → similarity = 0.

```
combo_weight = RATING_TO_WEIGHT[rating] × occasion_similarity
```

| Rating | Base weight |
|---|---|
| 0 (explicit bad) | 0.10 |
| 1 ★ | 0.20 |
| 2 ★★ | 0.40 |
| 3 ★★★ | 0.60 |
| 4 ★★★★ | 0.80 |
| 5 ★★★★★ | 1.00 |

The regenerate flow offers two signals:

| Button | Signal | Effect |
|---|---|---|
| Show me more | Neutral | Previously seen combos downranked 30 %; no negative stored |
| None of these work | Explicit negative | Current batch marked `mark_as_bad=True`; combo weights lowered |

When every possible combo has been shown, an exhaustion banner appears with a
**"Reset & start fresh"** option that clears ratings for the matching occasion
context via `POST /recommend/reset-feedback`.

---

### Grounded Explanations

After scoring, the `score_breakdown.tags` dict (color_story, silhouette, occasion,
completeness, risk) is passed to GPT-4o-mini. The model is instructed to reference
these specific signals — not generate generic praise. Example tags fed to the prompt:

```
• Color story: neutral base with navy accent
• Proportion: balanced proportion — volume contrasted with fitted
• Occasion fit: strong formality match
• Look completeness: complete layered look
```

---

## Design System

LuxeLook uses an **Editorial Dark** theme — a high-contrast, fashion-editorial
palette inspired by luxury magazine layouts.

| Token | Value | Usage |
|---|---|---|
| `--surface` | `#181714` | Card backgrounds |
| `--surface-alt` | `#111009` | Auth panel, secondary surfaces |
| `--input-bg` | `#1C1A14` | Form inputs |
| `--charcoal` / `--ink` | `#F0EBE2` | Primary text (ivory white) |
| `--muted` | `#9E9C98` | Secondary text — **7.09:1** contrast on `--cream` ✅ |
| `--gold` | `#D4A96A` | Primary actions, accents |
| `--gold-hover` | `#C49658` | Button hover state |
| `--border` | `#2A2620` | Dividers and outlines |

All text/background pairings pass **WCAG 2.1 AA** (4.5:1 minimum).
Token definitions live in `frontend/styles/globals.css`.

---

## Supabase Schema

Run in order:
1. `backend/schema.sql` — base tables, pgvector extension, RLS policies
2. `backend/supabase_migrations.sql` — all migrations by version

Key tables: `users`, `clothing_items`, `events`, `outfit_suggestions`, `discover_candidates`, `discover_style_interactions`, `user_style_preferences`, `style_catalog`, `style_taxonomy`, `clothing_tag_feedback`
Storage buckets: `clothing-images` (private), `profile-photos` (public)

`events.raw_text_json` stores the structured event brief payload, while `events.raw_text`
stores the readable summary used in archive displays and prompt context.

`style_catalog` is the canonical Discover style vocabulary and can now be seeded from the
same fallback catalog the app uses in code. `clothing_tag_feedback` stores user corrections
to AI-assigned wardrobe fields together with a snapshot of the item context at correction time.

### SECURITY DEFINER helpers (v1.9.4)

All clothing item writes use `SECURITY DEFINER` RPC functions instead of PostgREST table
`UPDATE` directly — required because PostgREST `PATCH` silently no-ops on this Supabase
project regardless of RLS policy. The three functions are defined in `supabase_migrations.sql`
and must be present before soft-delete / restore / tag-correction will persist:

| Function | Purpose |
|---|---|
| `soft_delete_clothing_item(item_id, user_id)` | Sets `is_active=false`, records `deleted_at` |
| `restore_clothing_item(item_id, user_id)` | Clears `is_active=true`, nulls `deleted_at` |
| `update_clothing_item_tags(item_id, user_id, ...)` | Updates scalar columns + merges descriptor JSONB |

After running the migration, reload the PostgREST schema cache: `NOTIFY pgrst, 'reload schema';`

---

## Deployment

| Service | Platform | Notes |
|---------|----------|-------|
| Frontend | Vercel | `vercel deploy` from `/frontend` |
| Backend | Render | Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Database | Supabase | Already hosted |

---

## Common Issues

**Item delete / update has no effect on the DB** — This project requires `SECURITY DEFINER` RPC functions for all clothing item writes (see Supabase Schema section). Run the v1.9.4 migration block from `supabase_migrations.sql` in the Supabase SQL editor, then run `NOTIFY pgrst, 'reload schema';`.

**"No clothing items found"** — Upload at least a top + bottom + shoes, a dress + shoes, or a co-ord set + shoes before generating outfits. Adding outerwear unlocks layered templates; adding swimwear unlocks the beach/resort templates. Once you have items, an **"Unlock more looks"** nudge appears after generation to guide you toward filling gaps.

**Deleted an item by accident?** — Items are soft-deleted (moved to Trash, not permanently removed). Open the Trash via the button in the Wardrobe header and click **Restore** to bring an item back. If you've since uploaded a newer version of the same item, the old trash copy is auto-purged on restore attempt. Items in trash for 90+ days are permanently removed by the auto-purge cron (see `supabase_migrations.sql` for setup options).

**Backend can't connect to Supabase** — Check `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `.env`. The service role key is required for backend operations.

**CORS errors** — Ensure backend runs on port 8000 and `NEXT_PUBLIC_API_URL=http://localhost:8000` is set.

**Token expired** — JWT tokens expire after 24 hours. Log out and back in.

**CLIP model slow on first run** — The model (~1.7GB) downloads once and caches. Subsequent runs are fast. Set `USE_MOCK_AI=true` to skip during development.

**Face shape not detected** — GPT-4o needs a clear, well-lit, front-facing photo. Use the FaceShapeTool landmark tool as a fallback.
