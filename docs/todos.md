# LuxeLook Todo Backlog

This file captures larger feature work we want to keep visible without forcing immediate implementation.

## Batch Upload Flow

Status: `planned`
Priority: `high`
Scope: `multi-pass`

### Product Summary

Add a dedicated batch-upload wardrobe ingestion flow where users can upload multiple clothing photos in one go, let AI tag/store them in the background, and later verify the tagged items in a separate review surface.

### UX Direction

- Add a dedicated `Batch Upload` page for multi-photo upload.
- Keep the current single-item wardrobe upload flow unchanged.
- Do not show the immediate AI tag review modal during batch upload.
- Add a separate `Batch Review` page for items awaiting user verification.
- Add a `Notifications` nav tab in a later pass to surface:
  - `AI tagging in progress`
  - `Awaiting user verification`

### Recommended Delivery Phases

#### Phase 1 — Batch upload foundation

- Add `upload_batch_sessions`
- Add `upload_batch_items`
- Add `verification_status` / `ingestion_source` support on wardrobe items
- Build backend session/item APIs
- Build `Batch Upload` page
- Support async status polling

#### Phase 2 — Review flow

- Build `Batch Review` page
- Reuse the existing wardrobe edit modal / item editor
- Add `Verify` and `Reject` actions
- Keep session/item counts in sync

#### Phase 3 — Notifications

- Add notifications table/API/UI
- Add nav tab
- Surface progress + awaiting-verification sessions

#### Phase 4 — Polish

- Retry failed items
- Handle duplicates more gracefully
- Improve session history
- Add badge counts / completion summaries

### Task-by-Task Implementation Plan

1. Add database tables:
   - `upload_batch_sessions`
   - `upload_batch_items`
2. Add supporting fields to `clothing_items`:
   - `verification_status`
   - `ingestion_source`
3. Add backend request/response schemas.
4. Add `batch_upload_service.py`.
5. Add `batch_upload.py` router and register it.
6. Add frontend API client methods for batch sessions/items.
7. Build `frontend/pages/batch-upload.tsx`.
8. Wire upload flow with limited concurrency and polling.
9. Build `frontend/pages/batch-review/[sessionId].tsx`.
10. Extract/reuse the wardrobe item editor into a shared component if needed.
11. Add verify/reject actions on reviewed items.
12. Add a lightweight return path to unfinished sessions.
13. Add session history display.
14. Handle partial failures / duplicate cases cleanly.
15. Validate end-to-end before notifications.

### Important Constraints

- Start with a maximum batch size of `5`.
- Keep this as a parallel flow, not a rewrite of single upload.
- Reuse current tagging/media logic instead of duplicating it.
- Treat notifications as a later pass, not a prerequisite.

### Main Challenges

- Storage + DB consistency across multiple images
- Per-item + per-session status transitions
- Avoiding duplicate logic with the single-upload wardrobe flow
- Preserving UX clarity when batches partially fail
- Keeping unverified items from being treated as fully trusted

### Proposed New Routes

- `frontend/pages/batch-upload.tsx`
- `frontend/pages/batch-review/[sessionId].tsx`
- `frontend/pages/notifications.tsx` (later pass)

### Proposed New Backend Modules

- `backend/routers/batch_upload.py`
- `backend/services/batch_upload_service.py`
- `backend/routers/notifications.py` (later pass)

## Discover Preference Model Upgrade

Status: `planned`
Priority: `high`
Scope: `multi-pass`

### Product Summary

Improve Discover personalization by moving from the current lightweight swipe aggregation toward a stronger hybrid recommendation model built around content-based preference learning, implicit feedback, and diversity controls.

### Recommendation Direction

- Do **not** start with classic collaborative filtering as the primary upgrade.
- Start with a stronger `content + implicit feedback + diversity` model using existing Discover card metadata:
  - `style_ids`
  - `style_tags`
  - `family_key`
  - style dimensions like silhouette / fabric / pattern / vibe / color family
- Revisit collaborative filtering later only if we have enough stable shared style entities across users.

### Why This Is The Better Fit Right Now

- Discover cards are external and transient, not a stable shared item catalog.
- The same visual look can appear under different URLs or different tag sets.
- The current quality bottlenecks are:
  - duplicate source images
  - near-duplicate style repetition
  - weak family grouping
  - preference refresh reliability
- A stronger content-based model will fit the current codebase much better than matrix factorization or deep collaborative filtering.

### Recommended Delivery Phases

#### Phase 1 — Stabilize Discover data quality

- Strengthen exact duplicate suppression
- Strengthen similar-style suppression beyond exact family-key matching
- Improve family-key grouping so adjacent near-duplicates do not slip through
- Verify preference refresh triggers and status surfaces are reliable

#### Phase 2 — Stronger user style profile

- Build a weighted user style profile from Discover interactions
- Track positive and negative preference weights by style dimension
- Add recency weighting so recent swipes matter more than old ones
- Add stronger confidence modeling so low-signal tags do not dominate

#### Phase 3 — Better ranking

- Score candidates by content affinity to liked styles
- Penalize similarity to disliked styles
- Add novelty/diversity penalty so similar looks are not shown too often
- Add family cooldown / exposure shaping into candidate ranking, not just suppression

#### Phase 4 — Embedding layer

- Build a user taste embedding from liked/disliked Discover cards
- Blend embedding similarity with style-tag affinity
- Use this as a reranking layer rather than a fully separate recommender

#### Phase 5 — Collaborative methods later

- Revisit collaborative filtering only if:
  - Discover candidates become more stable / normalized
  - enough users interact with overlapping style entities
  - shared preference patterns are strong enough to justify it

### Task-by-Task Implementation Plan

1. Audit current Discover interaction quality:
   - duplicates
   - family-key collisions / misses
   - refresh cadence
2. Add stronger duplicate and near-duplicate feed suppression.
3. Expand family-signature logic or add adjacent similarity scoring.
4. Build a per-user weighted style profile by dimension.
5. Add recency decay to interaction weights.
6. Add a disliked-style penalty to candidate ranking.
7. Add a novelty/diversity penalty so repeated silhouettes/patterns are spaced out.
8. Add profile confidence / signal-strength reporting for debugging.
9. Add a small offline evaluation script against real swipe history.
10. Only after those steps, reconsider collaborative filtering.

### Important Constraints

- Keep this grounded in the current Discover data model first.
- Avoid introducing heavyweight ML infra too early.
- Do not rely on collaborative filtering until shared-item stability is real.
- Prefer incremental ranking improvements over a full recommender rewrite.

### Main Challenges

- Same visual style can appear under different URLs/tags
- Family grouping is still too weak for some near-duplicate cases
- Discover cards are external and noisy
- Preferences need better reliability and freshness
- Diversity rules need to balance exploration without making the feed feel random

### Proposed New / Updated Modules

- `backend/services/discover_service.py`
- `backend/services/style_learning.py`
- `backend/services/discover_candidates.py`
- optional later:
  - `backend/services/discover_ranker.py`
  - `backend/scripts/evaluate_discover_preferences.py`
