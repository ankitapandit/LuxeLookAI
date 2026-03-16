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
| Python | 3.10+ | https://python.org |
| Node.js | 18+ | https://nodejs.org |
| pip | latest | comes with Python |
| npm | latest | comes with Node.js |

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

## Step 2 — Set up the Backend

### 2a. Create a virtual environment

```bash
cd backend
python3 -m venv venv

# On macOS/Linux:
source venv/bin/activate

# On Windows:
venv\Scripts\activate
```

### 2b. Install dependencies

```bash
pip install -r requirements.txt
```

> ⚠️ Note: `torch` and `transformers` are large packages (~2GB).
> In mock mode (the default), they are not actually loaded at runtime.
> They are listed as dependencies for when you switch to real AI mode.
> If you want a lighter install for now, you can skip them:
> `pip install fastapi uvicorn pydantic pydantic-settings python-jose supabase python-multipart openai numpy Pillow`

### 2c. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
OPENAI_API_KEY=sk-your-key        # leave as-is for mock mode
JWT_SECRET=any-long-random-string  # e.g. openssl rand -hex 32
USE_MOCK_AI=true                   # keeps things runnable without real keys
```

### 2d. Start the backend server

```bash
uvicorn main:app --reload --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

Open [http://localhost:8000/docs](http://localhost:8000/docs) — you'll see the full interactive API docs (Swagger UI). ✅

---

## Step 3 — Set up the Frontend

### 3a. Install dependencies

```bash
cd ../frontend
npm install
```

### 3b. Configure environment variables

```bash
cp .env.local.example .env.local
```

Open `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3c. Start the frontend dev server

```bash
npm run dev
```

You should see:
```
▲ Next.js 14.2.3
- Local: http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) ✅

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
