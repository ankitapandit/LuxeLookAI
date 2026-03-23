# LuxeLook AI 💎

> AI-powered personal stylist. Upload your wardrobe, describe your occasion, get a styled outfit.

Built with **Next.js · FastAPI · Supabase · CLIP · OpenAI**.

---

## Architecture

```
luxelook-ai/
├── backend/                  # FastAPI Python API
│   ├── main.py               # App entry point + CORS
│   ├── config.py             # Environment variable loading
│   ├── schema.sql            # Run in Supabase SQL Editor
│   ├── routers/              # API route handlers
│   │   ├── auth.py           # POST /auth/signup, /auth/login
│   │   ├── clothing.py       # POST /clothing/upload-item, GET /items
│   │   ├── events.py         # POST /events/create-event
│   │   ├── recommendations.py# POST /recommend/generate-outfits
│   │   └── feedback.py       # POST /feedback/rate-outfit
│   ├── services/             # Business logic layer
│   │   ├── recommender.py    # Core outfit scoring engine
│   │   ├── clothing_service.py
│   │   └── event_service.py
│   ├── ml/                   # AI components
│   │   ├── embeddings.py     # CLIP embedding generation (mock + real)
│   │   ├── tagger.py         # Auto clothing attribute detection
│   │   └── llm.py            # Occasion parsing + outfit explanation
│   ├── models/
│   │   └── schemas.py        # Pydantic request/response models
│   └── utils/
│       ├── db.py             # Supabase client
│       └── auth.py           # JWT create + verify
│
└── frontend/                 # Next.js TypeScript app
    ├── pages/
    │   ├── index.tsx          # Landing + Auth (login/signup)
    │   ├── wardrobe.tsx       # Upload & browse wardrobe
    │   ├── events.tsx         # Describe occasion → AI parses
    │   └── outfits.tsx        # View + rate outfit suggestions
    ├── services/
    │   └── api.ts             # All API calls (Axios)
    ├── hooks/
    │   ├── useAuth.ts         # Auth state management
    │   └── useWardrobe.ts     # Wardrobe CRUD
    ├── components/
    │   └── layout/Navbar.tsx  # Top navigation
    └── styles/
        └── globals.css        # LuxeLook design tokens + utility classes
```

---

## Prerequisites

Make sure these are installed on your machine:

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.10–3.12 | https://python.org |
| Node.js | 18+ | https://nodejs.org |
| pip | latest | comes with Python |
| npm | latest | comes with Node.js |
| **uv** | latest | **recommended** — see below |

### Recommended: install uv for fast Python dependency installs

`uv` is a Rust-based pip replacement. On macOS, pip is noticeably slow because
it resolves and downloads packages sequentially and macOS has slow disk I/O for
thousands of small files. `uv` parallelises everything and uses a global cache,
making installs **10–100x faster** (e.g. 30 seconds instead of 5 minutes).

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

The `./dev.sh setup` command will detect uv automatically if it's installed,
and offer to install it for you if it isn't. pip is used as a fallback — everything
works without uv, just slower.

> **Python 3.13+ users:** `torch` wheels currently only exist up to Python 3.12.
> If you have Python 3.13 or 3.14, `./dev.sh setup` with uv will automatically
> download and use Python 3.12 for the venv — your system Python is unaffected.
> Without uv, you'll need to install Python 3.12 manually.

---

## Step 1 — Set up Supabase (5 minutes)

Supabase is a free Postgres database with Auth and file Storage built in.

1. **Create a free account** at [supabase.com](https://supabase.com)

2. **Create a new project** — choose any name (e.g. `luxelook-ai`)
   - Set a strong database password (save it somewhere)
   - Choose the region closest to you

3. **Run the database schema**
   - In your Supabase dashboard, go to **SQL Editor**
   - Open `backend/schema.sql` from this repo
   - Paste the entire contents and click **Run**
   - This creates all tables, indexes, and RLS policies

4. **Create the Storage bucket**
   - Go to **Storage** in your Supabase dashboard
   - Click **New bucket**
   - Name it exactly: `clothing-images`
   - Leave it as **private** (not public)
   - After creating, go to **Policies** and add:
     ```sql
     -- Allow users to upload to their own folder
     CREATE POLICY "User uploads" ON storage.objects
     FOR INSERT WITH CHECK (
       auth.uid()::text = (storage.foldername(name))[1]
     );
     ```

5. **Get your API keys**
   - Go to **Settings → API** in your Supabase dashboard
   - Copy:
     - **Project URL** (looks like `https://abcdefgh.supabase.co`)
     - **anon public key** (long JWT string)
     - **service_role key** (keep this secret — never expose in frontend)

---

## Step 2 — First-time setup (one command)

From the **project root**, run:

```bash
chmod +x dev.sh   # make it executable (macOS/Linux only, once)
./dev.sh setup
```

This single command:
- Creates the Python virtual environment in `backend/venv/`
- Installs all Python dependencies from `requirements.txt`
- Installs all Node dependencies via `npm install`
- Copies `backend/.env.example → backend/.env`
- Copies `frontend/.env.local.example → frontend/.env.local`

> ⚠️ `torch` and `transformers` are large (~2GB). In mock mode (the default) they
> are **not loaded at runtime** — so setup is fast. They only matter when you
> switch `USE_MOCK_AI=false`.

### 2a. Fill in your environment variables

After setup, open **`backend/.env`** and fill in:

```env
# Leave these as placeholders until you have real Supabase credentials:
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key

OPENAI_API_KEY=sk-your-key        # leave as-is for mock mode
JWT_SECRET=any-long-random-string  # generate with: openssl rand -hex 32
USE_MOCK_AUTH=true                 # no Supabase needed while true
USE_MOCK_AI=true                   # no OpenAI/CLIP needed while true
```

And **`frontend/.env.local`**:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co  # only needed when USE_MOCK_AUTH=false
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

## Step 3 — Start everything

```bash
./dev.sh
```

You'll see:

```
✓ Backend running  → http://localhost:8000
✓ Frontend running → http://localhost:3000

  App      → http://localhost:3000
  API docs → http://localhost:8000/docs
  Logs     → ./dev.sh logs
  Stop     → ./dev.sh stop
```

### Other commands

| Command | What it does |
|---|---|
| `./dev.sh setup` | First-time install (venv, npm, .env files) |
| `./dev.sh` | Start backend + frontend |
| `./dev.sh backend` | Start backend only |
| `./dev.sh frontend` | Start frontend only |
| `./dev.sh stop` | Stop all running services |
| `./dev.sh logs` | Show recent logs from both services |

Logs are written to `.dev-logs/backend.log` and `.dev-logs/frontend.log`.
Live tail: `tail -f .dev-logs/*.log`

---

## Step 4 — First Run

1. **Sign up** — create an account on the landing page
2. **Upload items** — go to Wardrobe, drag & drop some clothing photos
   - In mock mode, items get auto-tagged with random (but deterministic) attributes
3. **Create an event** — go to Events, type something like _"Dinner party Friday evening, smart casual"_
   - The AI will parse this into structured data (mocked)
4. **Get outfits** — click "Generate My Outfits"
   - The recommendation engine scores all your items and returns top 3 looks
5. **Rate outfits** — click the stars to give feedback

---

## Switching to Real AI

When you're ready to use real CLIP embeddings + OpenAI:

1. Get an OpenAI API key from [platform.openai.com](https://platform.openai.com)
2. Update `backend/.env`:
   ```env
   OPENAI_API_KEY=sk-your-real-key
   USE_MOCK_AI=false
   ```
3. The first time a real request is made, the CLIP model (~1.7GB) will be downloaded from HuggingFace and cached locally. Subsequent calls are fast.
4. Real OpenAI calls cost approximately:
   - Occasion parsing: ~$0.001 per event
   - Outfit explanation: ~$0.002 per outfit
   - Estimated V1 cost: $10–40/month

---

## API Reference

All endpoints are documented interactively at [http://localhost:8000/docs](http://localhost:8000/docs).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/signup` | Create account |
| POST | `/auth/login` | Get JWT token |
| POST | `/clothing/upload-item` | Upload + auto-tag image |
| GET | `/clothing/items` | List wardrobe |
| DELETE | `/clothing/item/{id}` | Remove item |
| POST | `/events/create-event` | Parse occasion text |
| POST | `/recommend/generate-outfits` | Generate outfit suggestions |
| POST | `/feedback/rate-outfit` | Submit 1–5 star rating |

All routes except `/auth/*` require `Authorization: Bearer <token>` header.

---

## Recommendation Engine

The scoring formula (from the spec):

```
score = w1 * color_score
      + w2 * formality_score
      + w3 * season_score
      + w4 * embedding_similarity
      + w5 * user_preference_weight
```

Default weights: `color=0.20, formality=0.35, season=0.25, embedding=0.15, preference=0.05`

Tune these in `backend/services/recommender.py` → `WEIGHTS` dict.

---

## Deployment

| Service | Platform | Notes |
|---------|----------|-------|
| Frontend | Vercel | `vercel deploy` from `/frontend` |
| Backend | Render | Set env vars in Render dashboard |
| Database | Supabase | Already hosted |

For Render backend, set `Start Command` to: `uvicorn main:app --host 0.0.0.0 --port $PORT`

---

## Common Issues

**"No clothing items found"** — Upload at least a top, bottom, and shoes (or a dress + shoes) before generating outfits. The recommender needs a complete outfit structure.

**Backend can't connect to Supabase** — Double-check your `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `.env`. The service key (not the anon key) is needed for the backend.

**CORS errors in the browser** — Ensure the backend is running on port 8000 and `NEXT_PUBLIC_API_URL=http://localhost:8000` is set.

**Token expired** — JWT tokens expire after 24 hours. Log out and log back in.
