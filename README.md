# LuxeLook AI 💎

> AI-powered personal stylist. Upload your wardrobe, describe your occasion, get a styled outfit.

Built with **Next.js · FastAPI · Supabase · CLIP · OpenAI (GPT-4o + GPT-4o-mini)**.

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
│   │   ├── clothing.py         # POST /clothing/tag-preview, /upload-item, GET /items, /items/deleted, POST /item/{id}/restore
│   │   ├── events.py           # POST /events/create-event, GET /events/list
│   │   ├── recommendations.py  # POST /recommend/generate-outfits
│   │   ├── feedback.py         # POST /feedback/rate-outfit
│   │   └── profile.py          # GET/PUT /profile, POST /profile/photo
│   ├── services/               # Business logic layer
│   │   ├── recommender.py      # Core outfit scoring engine
│   │   ├── clothing_service.py # Upload, tag, embed, duplicate detection
│   │   └── event_service.py    # Event creation and retrieval
│   ├── ml/                     # AI components
│   │   ├── embeddings.py       # CLIP embedding generation (mock + real)
│   │   ├── tagger.py           # CLIP zero-shot clothing attribute detection
│   │   └── llm.py              # Occasion parsing, outfit explanation,
│   │                           # face shape detection, clothing descriptors
│   ├── models/
│   │   └── schemas.py          # Pydantic request/response models
│   └── utils/
│       ├── db.py               # Supabase client (service role)
│       ├── auth.py             # JWT create + verify
│       ├── mock_auth_store.py  # In-memory auth for local dev
│       └── mock_db_store.py    # In-memory database for local dev
│
└── frontend/                   # Next.js TypeScript app
    ├── pages/
    │   ├── index.tsx            # Landing + Auth (login/signup)
    │   ├── wardrobe.tsx         # Upload, tag, browse wardrobe
    │   ├── events.tsx           # Describe occasion → AI parses → outfit suggestions
    │   ├── outfits.tsx          # View outfit history + rate suggestions
    │   └── profile.tsx          # User profile, body type, face shape, photo
    ├── components/
    │   ├── layout/Navbar.tsx    # Top navigation
    │   ├── FaceShapeTool.tsx    # Canvas landmark tool for face shape detection
    │   └── PhotoCropper.tsx     # Modal canvas cropper for profile photo
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
3. **Set up your profile** — body type, height, weight, complexion, face shape
   - Body type calculator from bust/waist/hip measurements
   - Complexion identifier from 3 questions
   - Face shape auto-detected from profile photo via GPT-4o Vision
4. **Create an event** — type e.g. _"Dinner party Friday evening, smart casual"_
   - Click **Generate Outfit Suggestions** — occasion is parsed silently on the backend,
     outfit generation begins immediately with no intermediate step
5. **Get outfit suggestions** — AI builds complete looks across 4 outfit templates
   (top+bottom+shoes, top+bottom+outerwear+shoes, dress+shoes, dress+outerwear+shoes).
   If the wardrobe is missing item types needed to unlock some templates, an
   **"Unlock more looks"** banner shows actionable hints below the suggestions.
6. **Rate outfits** — 1–5 stars to improve future suggestions
7. **Regenerate** — "Show me more" for a neutral refresh; "None of these work" to
   signal the current batch was wrong; ratings are tracked per combo + occasion context
   so future events of the same type benefit from accumulated feedback
8. **Reset** — if you've exhausted all combinations for an event a banner appears;
   "Reset & start fresh" clears combo ratings for that occasion context and starts fresh

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
| Face shape detection | GPT-4o | ~$0.02 per photo upload |
| Clothing descriptors | GPT-4o | ~$0.02 per item upload |

---

## API Reference

Full interactive docs at [http://localhost:8000/docs](http://localhost:8000/docs).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/signup` | Create account |
| POST | `/auth/login` | Get JWT token |
| POST | `/clothing/tag-preview` | AI tag + descriptor preview (no save) |
| POST | `/clothing/upload-item` | Upload, tag, embed and save item |
| GET | `/clothing/items` | List active wardrobe items |
| PATCH | `/clothing/item/{id}` | Correct tags on saved item |
| DELETE | `/clothing/item/{id}` | Soft-delete item (moves to trash, restorable) |
| GET | `/clothing/items/deleted` | List soft-deleted items (trash view) |
| POST | `/clothing/item/{id}/restore` | Restore a soft-deleted item (with duplicate guard) |
| POST | `/clothing/purge-deleted` | Hard-delete trash items older than 90 days |
| GET | `/clothing/tag-options` | Valid categories, colors for dropdowns |
| POST | `/events/create-event` | Parse occasion text |
| GET | `/events/list` | List all user events |
| POST | `/recommend/generate-outfits` | Generate outfit suggestions |
| GET | `/recommend/suggestions/{event_id}` | Fetch saved suggestions |
| POST | `/recommend/reset-feedback` | Clear combo ratings for an occasion context |
| POST | `/feedback/rate-outfit` | Submit 1–5 star rating |
| GET | `/profile` | Get user profile |
| PUT | `/profile` | Update profile fields |
| POST | `/profile/photo` | Upload photo + face shape detection |

All routes except `/auth/*` require `Authorization: Bearer <token>` header.

---

## Recommendation Engine

```
score = color(0.18) + formality(0.18) + season(0.12)
      + embedding(0.28) + preference(0.12) + coherence(0.12)
```

All six weights sum to 1.00. Tune in `backend/services/recommender.py` → `WEIGHTS` dict.

| Component | Weight | Notes |
|---|---|---|
| `color` | 0.18 | HSL hue-wheel perceptual distance (complementary, analogous, monochromatic, neutral) |
| `formality` | 0.18 | Distance from occasion formality target; category floor prevents unrealistic scores |
| `season` | 0.12 | Overlap between item seasons and occasion season |
| `embedding` | 0.28 | CLIP cosine similarity across outfit items |
| `preference` | 0.12 | Body-type silhouette prior (when profile is set) or combo feedback weight |
| `coherence` | 0.12 | 60 % pattern mixing penalty + 40 % fit consistency |

Previously shown combos are downranked by 30 % (`SEEN_PENALTY = 0.70`) rather than
excluded — keeps them available as fallbacks when the wardrobe is small.

### Color Scoring

RGB values are converted to HSL; scoring is hue-wheel based:

| Relationship | Hue distance | Score |
|---|---|---|
| Monochromatic | < 15 ° | 0.85 |
| Analogous | < 45 ° | 0.80 |
| Complementary | ~180 ° | 0.90 |
| Neutral (any hue) | saturation < 0.15 | 1.0 / 0.95 |

### Style Coherence

| Patterns in outfit | Score |
|---|---|
| 0 (all solid) | 1.00 |
| 1 | 0.85 |
| 2 | 0.55 |
| 3+ | 0.25 |

Fit consistency (oversized vs. fitted conflict ratio) is blended at 40 %.

### Body-Type Priors

When a user's body type is saved in their profile, the `preference` component
uses `BODY_TYPE_PREFERENCES` — a dict mapping `hourglass / rectangle / pear /
apple / inverted triangle / petite` to preferred descriptor values for `fit`,
`neckline`, `leg_opening` and `length`. Score = `0.5 + 0.5 × (matches / checks)`.

### Outfit Templates

The engine builds candidates across four structural templates, selects the
highest-scoring outfit from each, then fills remaining slots with overflow:

| Template | Structure |
|---|---|
| A | top → bottom → shoes |
| B | top → bottom → outerwear → shoes |
| C | dress → shoes |
| D | dress → outerwear → shoes |

Accessories (bags, belts, scarves etc.) are attached after core scoring —
up to 2 per outfit, rule-checked to avoid doubling the same subtype.

### Outfit Feedback Loop

Ratings are tracked at **combo level** (the specific combination of item IDs),
not at individual item level, preventing good items being penalised for a
bad pairing. Combos are scoped to an occasion context using `occasion_type +
formality + event_tokens` similarity — so a "dinner date" rating influences
future dinner suggestions but not job interview outfits.

The regenerate flow offers two signals:

| Button | Signal | Effect |
|---|---|---|
| Show me more | Neutral | Previously seen combos downranked 30 %; no negative stored |
| None of these work | Explicit negative | Current batch marked `mark_as_bad=True`; combo weights lowered |

When every possible combo has been shown, an exhaustion banner appears with a
**"Reset & start fresh"** option that clears ratings for the matching occasion
context via `POST /recommend/reset-feedback`.

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

Key tables: `users`, `clothing_items`, `events`, `outfit_suggestions`, `outfit_feedback`
Storage buckets: `clothing-images` (private), `profile-photos` (public)

---

## Deployment

| Service | Platform | Notes |
|---------|----------|-------|
| Frontend | Vercel | `vercel deploy` from `/frontend` |
| Backend | Render | Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Database | Supabase | Already hosted |

---

## Common Issues

**"No clothing items found"** — Upload at least a top + bottom + shoes, or a dress + shoes before generating outfits. Adding outerwear unlocks two additional outfit templates. Once you have items, an **"Unlock more looks"** nudge appears after generation to guide you toward filling gaps.

**Deleted an item by accident?** — Items are soft-deleted (moved to Trash, not permanently removed). Open the Trash via the button in the Wardrobe header and click **Restore** to bring an item back. If you've since uploaded a newer version of the same item, the old trash copy is auto-purged on restore attempt. Items in trash for 90+ days are permanently removed by the auto-purge cron (see `supabase_migrations.sql` for setup options).

**Backend can't connect to Supabase** — Check `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `.env`. The service role key is required for backend operations.

**CORS errors** — Ensure backend runs on port 8000 and `NEXT_PUBLIC_API_URL=http://localhost:8000` is set.

**Token expired** — JWT tokens expire after 24 hours. Log out and back in.

**CLIP model slow on first run** — The model (~1.7GB) downloads once and caches. Subsequent runs are fast. Set `USE_MOCK_AI=true` to skip during development.

**Face shape not detected** — GPT-4o needs a clear, well-lit, front-facing photo. Use the FaceShapeTool landmark tool as a fallback.
