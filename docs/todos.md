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

