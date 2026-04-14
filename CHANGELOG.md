# Changelog

All notable changes to LuxeLook AI are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## Version Summary

| Version | Date       | Description																												  |
|---------|------------|-----------------------------------------------------------------------------------------------------------------------------|
| 1.0.0   | 2026-03-16 | Initial upload — base codebase 																							  |
| 1.1.0   | 2026-03-16 | Development environment and dependency fixes																				  |
| 1.2.0   | 2026-03-24 | Real mode support, UI overhaul, occasion/outfit improvements																  |
| 1.3.0   | 2026-03-24 | Supabase migrations file																									  |
| 1.4.0   | 2026-03-25 | User profile page and personalization foundations																			  |
| 1.5.0   | 2026-03-25 | Clothing descriptors, duplicate detection, wardrobe hygiene 																  |
| 1.6.0   | 2026-03-27 | Descriptor overhaul, outfit templates, UX fixes																			  |
| 1.7.0   | 2026-03-30 | Scorer intelligence, outfit feedback loop, Editorial Dark theme															  |
| 1.8.0   | 2026-03-30 | Soft delete & restore, smarter outfit explanations, wardrobe coverage nudge												  |
| 1.8.1   | 2026-03-30 | Restore duplicate guard, auto-purge on supersede, 90-day seasonal purge													  |
| 1.9.0   | 2026-03-30 | Fashion-intuitive V2 scorer — outfit-level compatibility, color story, silhouette balance, novelty, risk 					  |
| 1.9.1   | 2026-03-30 | style_taxonomy DB table, 660-row seed, process-level taxonomy loader; live vocabulary without redeploy 					  |
| 1.9.2   | 2026-03-30 | New clothing categories: set (co-ord), swimwear, loungewear — CLIP labels, descriptors, body-type prefs, venue-aware scoring|
| 1.9.3   | 2026-03-30 | Expanded descriptors for set/swimwear/loungewear — top+bottom combos, bra-type attributes, underwear-bottom attributes 	  |
| 1.9.4   | 2026-03-31 | SECURITY DEFINER RPCs for reliable DB writes; descriptor edit support; wardrobe UI & auth cleanup                           |
| 2.0.0   | 2026-04-01 | Structured outfit cards, smarter color/stylist scoring, richer wardrobe filters, and split AI profiling photo flow          |
| 2.1.0   | 2026-04-01 | Event/Archive rename, mobile-first frontend polish, and major wardrobe performance upgrades                                  |
| 2.2.0   | 2026-04-02 | Session restore, wardrobe media activity/status, cutout extraction, and duplicate-safe outfit refreshes                    |
| 2.3.0   | 2026-04-09 | Discover taste-learning, Style Item workflow, jumpsuits taxonomy, and current data-model documentation                      |
| 2.4.0   | 2026-04-12 | Beach-aware scoring, structured event briefs, Discover preference reliability, and wardrobe taxonomy cleanup                |
| 2.4.1   | 2026-04-14 | Style-direction moodboards, event-token completeness, guide page, scenario testing, and UX reliability polish              |

---

## [2.4.1] - 2026-04-14

### Added
- **Beyond Your Wardrobe visual moodboards** — editorial style directions now return per-piece `image_url` values and render as visual moodboards instead of chip-only lists, including a dedicated [`backend/services/style_images.py`](/Users/anki/Desktop/Code/LuxeLookAI/luxelook-ai/backend/services/style_images.py) enrichment layer and the new [`frontend/components/StyleDirectionMoodboard.tsx`](/Users/anki/Desktop/Code/LuxeLookAI/luxelook-ai/frontend/components/StyleDirectionMoodboard.tsx) presentation component.
- **In-app Guide page** — added `/guide`, a user-facing reference page that explains wardrobe terms, dress-code ladders, season readings, descriptor families, and how profile details are used in suggestions.
- **Event scenario test harness** — added `/test/event-scenarios`, an isolated UI for loading saved event-brief JSON scenarios, editing them with the shared brief editor, and running real recommendation requests without touching the main Event page.
- **Style direction finishing chips** — hair and makeup now render as finishing chips beneath the style-direction moodboard instead of being mixed into the wearable-piece grid.

### Changed
- **Stitch moodboard fixed-zone placement** — `OutfitMoodboard` now uses strict zone rules: left column for the main garment + shoes, top-right for outerwear, and bottom-right for accessories / jewelry, with graceful fallbacks when zones are empty.
- **Event token completeness** — `_enrich_event_tokens()` now injects all 12 structured EventBrief form fields as lowercased tokens, rather than relying on a much smaller subset of occasion cues.
- **Direct dress-code formality override** — explicit dress-code selections now take precedence over softer inference through `_apply_direct_formality()` and the `_DRESS_CODE_FORMALITY` map in event creation, hydration, and mock flows.
- **Beyond Your Wardrobe placement in the tester** — the scenario test page now renders style-direction content below the wardrobe suggestions and uses the same visual moodboard treatment as the main Event page.
- **Guide page layout** — the wardrobe reference section now uses flatter horizontal boards and scrollable descriptor rails, while the descriptor illustrations use consistent fixed-size tiles.
- **Guide iconography** — neckline, fit, and length illustrations were iterated toward a clearer human-figure metaphor, with `length` now using a standing figure plus side-arrow only.

### Fixed
- **Shoe recommendation heel detection** — `_shoe_signals()` now checks the full concatenated shoe profile instead of only `shoe_type`, catching labels like `strappy heels` when the heel cue lives in `item_type`.
- **Walkable / outdoor footwear penalties** — heel penalties were strengthened for park, walking, grass, and other practical outdoor contexts, making grounded shoes more competitive when the brief clearly calls for them.
- **Minimalist extras discipline** — recommendation mood tokens now better constrain finishing pieces for minimalist briefs instead of treating them only as descriptive style language.
- **Event context hydration for older rows** — event retrieval now rehydrates structured occasion fields from `raw_text_json`, so older saved events benefit from newer token, formality, and practicality rules without being recreated.
- **`None of these looks` rating path** — the outfit rating constraint now allows `0` as a valid rating so the skip / reject flow no longer trips the `outfit_suggestions_user_rating_check`.
- **Form reset behavior** — the shared structured brief editor’s reset action now clears generated results too, returning Event and Style Item flows to their initial state instead of only wiping the inputs.
- **Guide page rail overflow** — wardrobe reference rows now scroll inside bounded containers instead of stretching the page width.

### Docs
- **Guide + scenario docs surfaced** — changelog and README now document the new `/guide` page, the `/test/event-scenarios` harness, and the style-direction image enrichment pipeline.
- **Architecture references updated** — supporting docs now mention the new style-direction image service and the guide route alongside the existing product surfaces.

## [2.4.0] - 2026-04-12

### Added
- **Beach / resort recommendation lane** — beach, pool, resort, and swim-led occasions now actively surface swimwear through venue-aware scoring, explicit swimwear affinity bonuses, and a guaranteed swimwear slot in the final candidate set when the wardrobe supports it.
- **Template H for beach layering** — outfit generation now supports both `swimwear + shoes` and `swimwear + outerwear + shoes`, giving resort and poolside events a lightweight layering path.
- **Structured event brief payloads** — event creation now stores a machine-readable `raw_text_json` alongside a human-readable event summary, so occasion parsing and archive rendering both have access to the user’s structured inputs.
- **Trend calendar scoring** — trend is no longer a flat placeholder; the recommender now blends a season-aware trend calendar with predicted outfit attributes to contribute a real trend signal.
- **Wardrobe correction feedback snapshots** — user corrections to AI-tagged wardrobe items now log the edited field plus a frozen item snapshot, creating a usable dataset for later prompt tuning and analytics.
- **`warmth` apparel descriptor** — apparel categories now support `warmth` (`airy`, `light`, `medium`, `warm`, `thermal`) so season-fit logic and manual editing can represent wearability more directly.
- **`style_catalog` seed and table comments** — the previously empty Discover style catalog is now seedable from the live fallback vocabulary, and key product tables are documented with Postgres comments inside the migration path.
- **Pexels-backed style-direction images** — the non-wardrobe recommendation lane can now enrich wearable pieces with a representative fashion image, supporting visual moodboards for `Beyond Your Wardrobe`.

### Changed
- **Beach occasion scoring** — venue-fit and risk logic now penalize denim, leather/suede/wool, closed-toe shoes, and overly structured silhouettes at beach events while giving swimwear, beach shoes, and lighter fabrics stronger numeric priority.
- **Season scoring blend** — season fit now combines the stored item season with descriptor-level rules rather than relying only on the top-level metadata label.
- **Event prompt composition** — structured brief data is now expanded into a richer prompt block for occasion parsing, and the archive page renders those same JSON fields back into cleaner English summaries.
- **Event summary generation** — `_humanize_event_summary()` now turns structured event form JSON into a clearer sentence for both prompt context and archive summaries, with optional fields dropping out cleanly when absent.
- **Event + Style Item input UX** — both flows now use the same structured brief editor with mobile-friendly dropdown behavior, optional detail handling, and “Other” value support.
- **Structured brief custom-value display** — when users choose `Other` in Event or Style Item, the selected control now displays the entered custom value directly instead of leaving a generic `Other` label or helper text behind.
- **Outfit loading state** — generic spinners on Event and Style Item were replaced with a themed clothing-assembly loader that cycles through wardrobe-relevant icons.
- **Moodboard presentation** — flat-lay boards now use a white stage on a neutral shell, tighter shadows, compact-aware placements, jewelry-capable accessory placement, reduced overflow, and equalized card heights in the carousel.
- **Stitch moodboard zone rules** — the stitch-style moodboard layout now follows explicit fixed-zone placement so shoes, outerwear, accessories, and jewelry stop drifting into visually awkward positions.
- **Swimwear taxonomy** — swimwear no longer borrows `tops`/`bottoms` descriptors; it now uses a dedicated vocabulary centered on `swimwear_style`, `coverage_level`, `cut`, and swim-specific fabric materials.
- **Set descriptor scope** — coordinated sets now expose a smaller, unified schema focused on `fabric_type`, `warmth`, `top_style`, `bottom_style`, `fit`, and `pattern` rather than mirroring full separate top and bottom editors.
- **Wardrobe descriptor editing** — wardrobe edit now exposes category, season, and dress code corrections together, hides duplicate / `None` descriptor chips on cards, and removes `sleeve_style` from the UI while keeping backend compatibility.
- **Jewelry split** — jewelry is now treated as its own category end-to-end rather than living under generic accessories, including recommendation surfaces and taxonomy handling.
- **Preference thresholds** — Discover learned-style thresholds now populate earlier through lower exposure/count requirements, faster gate scaling, and softer preferred/disliked boundaries.

### Fixed
- **Discover preference wipe bug** — learned preference rows are no longer deleted when a recompute pass produces no recognized aggregate; existing preferences stay intact instead of being wiped to empty.
- **Discover preference state clobber** — feed refreshes and status polls no longer overwrite freshly computed preference state with empty arrays on the frontend.
- **Discover style lookup drift** — preference recompute now resolves style rows against the shared style lookup rather than assuming one identifier shape.
- **Discover preference population timing** — commit-time preference refreshes now return usable rows synchronously so the UI can update immediately instead of waiting for a later poll.
- **Discover transient DB disconnects** — style-learning and Discover-service DB operations now use the same retry/reset pattern around transient `RemoteProtocolError` failures.
- **Event summary prompt bug** — Python `filter(Boolean, ...)` misuse in event-summary composition was removed, preventing dropped dress-code strings from the generated prompt text.
- **Wardrobe duplicate conflict recovery** — uploads that match items already in the wardrobe or archive once again present the right `replace`, `unarchive`, or `force add` options.
- **Wardrobe duplicate color handling** — duplicate detection now respects broad color families instead of over-collapsing visually similar items that exist in legitimately different colorways.
- **Archive preference and summary rendering regressions** — archive suggestions stay newest-first, event descriptions render in continuous sentence case, and the archive summary uses the structured event payload without awkward capitalization resets.
- **Archive false-failure toast** — the Archive page now retries its initial load once before surfacing a failure toast, preventing transient startup hiccups from showing an error when the page ultimately loads successfully.
- **Style Item anchor preview spacing** — the right-side anchor preview no longer stretches to the full height of the left column, removing the large empty block beneath shorter preview content.

### Docs
- **README refreshed for current product behavior** — the README now reflects structured event creation, beach/resort swimwear support, current descriptor vocabularies, and the active Discover / style-catalog architecture.
- **Supabase migration documentation expanded** — changelog and migration docs now describe table comments, the `style_catalog` seed path, and the wardrobe correction feedback log.

## [2.3.0] - 2026-04-09

### Added
- **Discover / The Edit** — added a new swipe-driven discovery surface powered by a seeded fashion image feed, per-user candidate cache, swipe logging, learned style preferences, ignored-link tracking, and a dedicated background job pipeline.
- **Embedded Discover worker** — the backend now starts an embedded Discover worker on app startup for local/dev use, with durable `discover_jobs` rows handling candidate warm-up and style-preference refreshes.
- **Pexels-backed Discover provider** — Discover search now runs through a provider abstraction and uses Pexels as the live image source, with mock fallback when no API key is configured.
- **Style Item page** — added `/style-item`, a dedicated “style around this wardrobe piece” flow that anchors recommendations to one selected item and falls back to editorial guidance when a complete wardrobe-only look is not possible.
- **Discover taste-learning schema** — formalized `style_catalog`, `discover_candidates`, `discover_style_interactions`, `discover_ignored_urls`, `user_style_preferences`, and `discover_jobs` as first-class product tables in the documented schema.
- **Gender and ethnicity profile fields** — both fields now flow through backend models, Supabase schema, and the profile UI with `prefer_not_to_say` defaults.
- **Jumpsuits category** — jumpsuits/rompers/playsuits now exist as a dedicated clothing category with their own descriptor vocabulary and recommendation handling.
- **Archived metadata** — `is_archived` and `archived_on` are now tracked explicitly on wardrobe items instead of relying only on soft-delete semantics.
- **Data model reference** — added a dedicated conceptual data-model document with ER diagram and record-style table definitions in `docs/data-model.md`.

### Changed
- **Discover analysis path** — candidate filtering and style-tag extraction now use the cached CLIP/Hugging Face path already present in the repo instead of per-candidate OpenAI vision calls.
- **Discover query seeding** — search context now centers on complexion + gender + season, with learned style signals layered in; body shape is no longer part of the seed query.
- **Discover UI behavior** — the page now tracks cumulative learning milestones, daily local-time swipe quotas, mobile-ready card layout, and touch swipe gestures while preserving buttons as fallback.
- **Discover intro language** — the stage copy now explains the page through taste learning rather than search mechanics.
- **Wardrobe archive language** — user-facing trash language has been renamed to Archived throughout the wardrobe flow.
- **Wardrobe upload review** — season mismatch handling now appears inline in the review modal with an archive-after-save option instead of forcing a separate prompt.
- **Wardrobe category taxonomy** — dresses no longer absorb jumpsuits implicitly; `jumpsuits` is now distinct in wardrobe filters, descriptors, and scoring.
- **Frontend dependency baseline** — the frontend now targets the patched Next.js `15.5.15` line, and `dev.sh` no longer mutates dependencies via `npm audit fix`.

### Fixed
- **Discover worker deadlock in local dev** — queued Discover jobs no longer sit forever waiting on a manually started worker in normal development.
- **Discover feed exhaustion** — cards are no longer excluded from future fetches merely for being shown once; ignored-link counts now reflect actual swiped looks.
- **Discover interaction throttling mismatch** — daily quota logic now resets on the user’s local day while timestamps remain stored in UTC.
- **Discover warm-up visibility** — the frontend now handles warm-up, refresh, and empty states more clearly without exposing internal worker counters to end users.
- **Discover retry storms** — permanent provider/config failures now stop retrying as terminal errors instead of burning repeated background attempts.
- **Wardrobe archived count lag** — the Archived badge now updates immediately without requiring the user to open the archive tab first.
- **Wardrobe LCP warning** — the first above-the-fold wardrobe images now opt into `next/image` priority.
- **Form accessibility gaps** — key wardrobe/profile/auth fields now carry `id`/`name` attributes and proper label associations.

### Docs
- **README refreshed for current product surface** — docs now reflect Discover, Style Item, Pexels configuration, embedded worker behavior, and current route structure.
- **Conceptual schema document added** — `docs/data-model.md` now captures the live table model, cascade rules, and product-domain relationships for the app.

## [2.2.0] - 2026-04-02

### Added
- **Refresh-safe auth session restore** — the app now restores the cached login session on page refresh through a shared auth provider, so returning users stay signed in instead of being bounced back to the landing page.
- **Wardrobe media activity tray** — wardrobe uploads now surface live processing states in a compact, minimizable tray, with per-item status updates for queued, preview generation, subject extraction, ready, and failed states.
- **Deferred media processing pipeline** — uploaded clothing items now save immediately and generate thumbnails / subject cutouts in the background (`thumbnail_url`, `cutout_url`), with `rembg` + Pillow handling extraction and cleanup.
- **Duplicate-safe outfit refreshes** — regenerated Event/Archive suggestions are de-duplicated by outfit combo, so the same exact look does not reappear multiple times in a refreshed batch.
- **Rating carry-forward by combo** — if a previously rated outfit combo appears again for the same event, its stars are preserved instead of resetting to unrated.
- **Editorial moodboard refinements** — outfit suggestions now use a moodboard-style presentation with hoverable item titles and a larger full-board view for the selected look.

### Changed
- **Wardrobe save flow** — uploads now complete faster because heavy image work no longer blocks the initial save response.
- **Wardrobe descriptor consistency** — shared fabric vocabulary is now uniform across code and taxonomy, including expanded fabric values such as `leather`, `elastane`, and `spandex`, and `set` descriptors now prefix top/bottom fields so they remain identifiable in edit mode.
- **Outfit title hierarchy** — outfit cards prefer editorial `look_title` labels where available instead of reusing the same vibe text as the board title.
- **Event / Archive refresh behavior** — refreshed suggestions now keep previously rated stars visible, and the UI makes saved ratings explicit even when an outfit reappears.
- **Outfit generation freshness** — the generator now prefers fresh combos first and only falls back when the wardrobe is truly exhausted.

### Fixed
- **Login state lost on refresh** — full page reloads now preserve the authenticated session instead of forcing the user to log in again.
- **Repeated looks after regenerate** — exact duplicate outfit combos are filtered out so refreshes no longer show repeated suggestions when fresh alternatives still exist.
- **Star ratings resetting on reappearance** — previously rated looks now keep their rating when the same combo is regenerated for the same event.
- **Wardrobe upload latency** — the wardrobe save path is no longer slowed down by synchronous thumbnail/cutout generation.
- **Archive suggestion duplication** — fetched suggestion batches are de-duped by combo key so repeated stored rows do not echo in the UI.

### Docs
- **README updated for refresh-safe sessions and media processing** — docs now describe session restore, the wardrobe activity tray, background media generation, thumbnail/cutout extraction, and duplicate-safe outfit refresh behavior.

## [2.1.0] - 2026-04-01

### Added
- **Event and Archive route migration** — user-facing Events/Outfits naming has been refactored to `Event` and `Archive`, including new frontend pages, backend `event` router wiring, and permanent redirects from legacy `/events` and `/outfits` URLs.
- **Mobile navigation and responsive typography system** — the frontend now has a collapsible mobile navbar, shared responsive type classes, and page-level mobile layout adjustments across landing, Event, Archive, Profile, and Wardrobe.
- **Wardrobe pagination API** — added `GET /clothing/items/page` with server-side filtering by category, season, and dress code for incremental wardrobe loading.
- **Stored wardrobe thumbnails** — clothing uploads now generate a `thumbnail_url` alongside the original image, with schema/migration support and frontend consumption in wardrobe, Event, and Archive views.
- **Thumbnail backfill endpoint** — added `POST /clothing/backfill-thumbnails` so existing wardrobe items can be upgraded with generated thumbnails without re-uploading.

### Changed
- **Wardrobe loading model** — wardrobe now uses infinite scroll in 12-item batches with a `Load more` fallback instead of rendering the full closet at once.
- **Wardrobe data fetching** — trash items and tag options are now lazy-loaded only when needed, and active wardrobe list payloads no longer ship `embedding_vector` on the normal browsing path.
- **Wardrobe edit/delete architecture** — per-card modal state has been replaced with one shared edit modal and one shared delete dialog to reduce React overhead on large wardrobes.
- **Wardrobe edit experience** — the edit modal now includes the garment image as an in-modal reference while changing color/pattern, preserves existing descriptor values, and lets `set` inherit descriptor groups from both tops and bottoms.
- **Wardrobe count display** — the wardrobe header now shows the total closet count instead of the currently loaded slice.
- **Remote image delivery** — wardrobe, Event, Archive, and profile image rendering now uses `next/image` more consistently, with optimization bypassed only for local `blob:` and `data:` preview sources.
- **Touch and empty-state UX** — wardrobe actions are more discoverable on smaller screens, and filtered-empty results are now clearly distinguished from a truly empty wardrobe.

### Fixed
- **Hook dependency warnings** — cleaned up stale React hook dependency warnings in Archive and Wardrobe.
- **Image optimization warnings** — replaced flagged raw `<img>` usage on key pages with `next/image`.
- **Wardrobe loading spinner alignment** — the wardrobe loading state spinner is now properly centered.
- **Descriptor visibility regression in edit mode** — existing saved descriptors no longer disappear when editing categories whose descriptor map is composed or partially inferred.

### Docs
- **README updated for current routes and wardrobe pipeline** — documentation now reflects `Event`/`Archive`, the paginated wardrobe API, thumbnail generation/backfill, and current storage/setup expectations.

## [2.0.0] - 2026-04-01

### Added
- **Structured outfit cards end-to-end** — outfit suggestions now carry a persisted `card` JSON payload with `trend_stars`, `trend_label`, `vibe`, `color_theory`, `fit_check`, `weather_sync`, optional `risk_flag`, and a short `verdict`. Added to backend schemas, API types, and `outfit_suggestions.card` via `supabase_migrations.sql`.
- **Shared outfit card component** — added `frontend/components/OutfitCard.tsx` so the same metric-card UI, schema guard, and verdict formatting are reused consistently on both Events and Outfits pages.
- **Editorial stylist verdict generation** — `ml/llm.py` now generates punchier short-form stylist verdicts tuned for the new outfit card instead of relying only on a long explanation paragraph.
- **AI profiling photo flow** — profile now supports a dedicated `POST /profile/ai-photo` endpoint, separate `ai-profile-photos` bucket, `ai_profile_photo_url`, `ai_profile_analysis`, and `ai_profile_analyzed_at` fields, plus frontend helpers and UI for a dedicated analysis image distinct from the visible avatar.
- **Age range profile field** — added to backend schemas, API types, user profile persistence, migrations, and the profile page UI.
- **Wardrobe filtering improvements** — wardrobe now supports multi-axis filtering by clothing type, season, and dress code instead of a single category-only filter.
- **Color normalization utility** — `backend/utils/color_utils.py` is now used by clothing upload/edit paths and wardrobe editing to keep stored color names and swatch highlighting consistent.
- **`webcolors` dependency** — added to backend requirements to support CSS color-name resolution, nearest-color fallback, and friendlier fashion-facing color labels.

### Changed
- **Outfit history and event suggestion UI** — `events.tsx` and `outfits.tsx` now render the structured metric card when present, hide stale schemas safely, and silently refresh outdated pre-card suggestions when needed.
- **Recommendation engine output** — `services/recommender.py` now builds metric cards directly from scorer breakdowns and stores the short verdict in the legacy `explanation` field for backward compatibility.
- **Color language normalization in LLM copy** — outfit explanations and stylist verdicts now normalize color names before generating copy so raw hex codes like `#245761` do not leak into user-facing fashion copy.
- **Profile photo semantics** — `/profile/photo` is now avatar-only; AI analysis is handled by the separate AI profiling photo flow. The profile page copy and API docs were updated to reflect that split.
- **Profile page UX** — AI profiling is now a distinct, minimizable section with “Use profile photo” support, per-trait AI suggestions, manual apply controls, and clearer messaging about what is saved immediately versus on `Save Profile`.
- **Wardrobe edit swatch matching** — normalized stored colors such as dark/variant shades now map back to the nearest preset swatch so existing items no longer appear unselected in the edit modal when their saved color is a normalized variant name.

### Fixed
- **Profile cropper double-upload path** — selecting a profile avatar no longer uploads immediately and then again after crop; the avatar upload now occurs once from the crop completion path.
- **Mock auth profile bootstrap** — mock signup now seeds a matching `users` row so `/profile` and profile photo flows work correctly in local mock mode.
- **Face-shape parsing robustness** — face-shape detection now strips fenced JSON and normalizes the returned payload more defensively before persisting results.
- **AI profile upload debugging** — added targeted server-side debug prints around AI profiling validation, storage upload, analysis, and DB update steps to make local upload failures easier to trace.
- **Wardrobe color correction persistence** — clothing upload and correction routes now normalize incoming color values before storing them, preventing mismatches between saved values and UI swatches.

### Docs
- **README updated for profile flow changes** — docs now describe the dedicated AI profiling photo, the new `/profile/ai-photo` endpoint, the `ai-profile-photos` bucket, and updated OpenAI cost wording for profiling analysis.

## [1.9.4] - 2026-03-31

### Fixed
- **Wardrobe delete / update silently no-ops** — PostgREST `PATCH` does not persist for this Supabase project regardless of RLS or schema-cache state. All clothing item writes now route through `SECURITY DEFINER` functions (`soft_delete_clothing_item`, `restore_clothing_item`, `update_clothing_item_tags`) that execute as the `postgres` owner, identical to the Supabase SQL editor.
- **Descriptor edits lost on update** — `descriptors` JSONB was never sent to the backend (`api.ts` omitted it from query params). Individual descriptor keys (e.g. `fabric_type`) are now correctly sent, parsed by the router, and merged into the existing JSONB — changing one key never overwrites unrelated keys. Both addition (new key) and modification (existing key) are handled correctly.
- **Restored item shows without tags/descriptors** — `GET /clothing/items/deleted` was returning only 5 fields (`id, category, item_type, color, image_url, deleted_at`), so the trash copy lacked `season`, `formality_score`, `descriptors`, `pattern` etc. Now selects all display fields. Frontend also re-fetches the full active wardrobe after a successful restore instead of spreading the local trash copy.
- **Trash button disappears when trash empties** — button was conditionally rendered on `deletedItems.length > 0`; once all items were restored the button vanished with no way back to the wardrobe view. Button now stays visible while `showTrash` is `true` and its label switches to `← Back to Wardrobe` when the trash is empty.
- **Debug `print("login", ...)` statement** removed from `routers/auth.py`.

### Added
- **Descriptor editing via PATCH** — `PATCH /clothing/item/{id}` now accepts a `descriptors` query param (JSON string). The `update_clothing_item_tags` RPC merges incoming keys into stored JSONB using `||`.
- **`supabase_migrations.sql` v1.9.4** — three `CREATE OR REPLACE FUNCTION … SECURITY DEFINER` statements (`soft_delete_clothing_item`, `restore_clothing_item`, `update_clothing_item_tags`). Idempotent, safe to re-run. After applying, run `NOTIFY pgrst, 'reload schema';`.

### Changed
- **Set descriptor vocabulary** — expanded with full top-half (`neckline`, `sleeve_length`, `sleeve_style`, `strap_type`, `back_style`) and bottom-half (`waist_position`, `waist_structure`, `leg_opening`, `hemline`, `length`, `elasticity`) attributes.
- **Swimwear descriptor vocabulary** — renamed `coverage` → `top_coverage`; added bra-type (`support`, `structure`, `function`, `fit_intent`) and underwear-bottom (`bottom_rise`, `back_coverage`, `bottom_fit_style`, `bottom_visibility`) attributes.
- **Loungewear descriptor vocabulary** — added top-half (`neckline`, `sleeve_length`, `strap_type`), light-bra (`support`, `structure`, `fit_intent`), and bottom-half (`waist_structure`, `bottom_length`) attributes.

---

## [1.9.3] - 2026-03-30

### Added
- **Set** — top-half descriptors: `neckline`, `sleeve_length`, `sleeve_style`, `strap_type`, `back_style`; bottom-half descriptors: `waist_position`, `waist_structure`, `leg_opening`, `hemline`, `length`, `elasticity`
- **Swimwear** — bra-type attributes: `support` (low/medium/high), `structure` (wired/wireless/padded/unlined), `function` (everyday/sports/beach/special occasion), `fit_intent` (enhance/minimize/natural); renamed `coverage` → `top_coverage`; underwear-bottom attributes: `bottom_rise`, `back_coverage`, `bottom_fit_style` (thong/bikini/boyshort/brief/high-waist/hipster/cheeky/string), `bottom_visibility` (seamless/no-show/regular)
- **Loungewear** — top-half: `neckline`, `sleeve_length`, `strap_type`; light-bra: `support` (none/light/medium), `structure` (wireless/padded/unlined/built-in), `fit_intent`; bottom-half: `waist_structure` (elastic/drawstring/tie), `bottom_length` (shorts/capri/ankle/full-length)
- `supabase_migrations.sql` v1.9.3 block (3 idempotent INSERT statements, ~100 new descriptor rows)

---

## [1.9.2] - 2026-03-30

### Added
- Three new clothing categories supported end-to-end: **set**, **swimwear**, **loungewear**

**CLIP classification (`ml/tagger.py`)**
- Added to `CATEGORY_LABELS` with category-specific zero-shot prompts:
  - `set` — "a photo of a co-ord set or matching two-piece outfit…"
  - `swimwear` — "a photo of swimwear such as a bikini, one-piece swimsuit, tankini…"
  - `loungewear` — "a photo of loungewear, pajamas, sweatpants, joggers…"

**Descriptor vocabulary (`ml/llm.py`)**
- `set`: fabric_type, fit, top_style (crop/halter/bandeau/blazer…), bottom_style
  (shorts/skirt/trousers/wide-leg…), pattern, closure, detailing
- `swimwear`: swimwear_type (bikini/one-piece/tankini/monokini/swim dress…),
  top_style, coverage (minimal/moderate/full), neckline, fabric_type, pattern, closure
- `loungewear`: loungewear_type (hoodie/joggers/pajama set/robe/shorts set…),
  fabric_type (cotton/fleece/modal/silk/satin/bamboo/waffle-knit), fit, closure,
  length, pattern, detailing (ribbed/sherpa lined/kangaroo pocket…)

**Body-type preferences (`services/recommender.py`)**
- All six body types (hourglass/rectangle/pear/apple/inverted triangle/petite) updated
  with `set`, `swimwear`, and `loungewear` preference blocks using category-appropriate
  fit and style attributes

**Scorer updates (`services/recommender.py`)**
- `score_silhouette_balance()` — `set` and `loungewear` now included in the fit
  proportion check (previously only tops/bottoms/dresses/outerwear were checked)
- `score_diversity_completeness()` — `set` and `swimwear` both count as `core_complete`
  (a co-ord set covers the top + bottom slots; a swimsuit is a complete base garment);
  swimwear + shoes returns 0.85 "complete look" without needing separate top/bottom
- `score_appropriateness_v2()` — venue multiplier penalties added:
  - Swimwear outside beach/pool context → multiplier capped at 0.30
  - Loungewear at formal events or occasion formality > 0.55 → multiplier capped at 0.40
- `score_risk_penalty()` — hard risk penalties added:
  - Swimwear outside beach/pool → +0.35 penalty ("swimwear outside beach/pool context")
  - Loungewear at occasion formality > 0.40 → +0.20 ("loungewear inappropriate for occasion formality")

**Taxonomy seed (`supabase_migrations.sql`)**
- v1.9.2 migration block: 3 CLIP label rows, ~110 descriptor rows (set/swimwear/loungewear),
  ~70 body_type rows for all 6 body types × 3 new categories; idempotent (`ON CONFLICT DO NOTHING`)

### Changed
- **Wardrobe sort order** — wardrobe grid now displays newest items first (`created_at DESC`) so recently uploaded pieces are immediately visible at the top.
- **"Has a Pattern" toggle removed** — replaced with an auto-detected `pattern` field populated by the AI tagger; the manual toggle was redundant and inconsistent with how pattern data is stored.

### Fixed
- **`correct_item_tags` Supabase path** — tag correction was falling back to mock-mode logic in real mode; real-mode path now uses the Supabase client correctly to persist category, color, season, formality, and descriptor updates.

---

## [1.9.1] - 2026-03-30

### Added
- `style_taxonomy` table in `supabase_migrations.sql` — stores all fashion vocabulary
  and configuration data that was previously hardcoded across backend files; columns:
  `domain`, `category` (empty string sentinel for global rows), `attribute`, `value`,
  `meta jsonb`, `sort_order`, `is_active`
- 660-row seed data appended to `supabase_migrations.sql` across 5 domains:
  - `descriptor` (450 rows) — full `CATEGORY_DESCRIPTORS` vocabulary from `ml/llm.py`;
    all valid attribute values per clothing category (tops/dresses/outerwear/bottoms/shoes/accessories)
  - `color` (34 rows) — `COLOR_RGB` mappings with embedded `clip_prompt` in `meta` jsonb;
    consolidates two previously separate hardcoded dicts into one source of truth
  - `clip_label` (17 rows) — CLIP zero-shot classification prompts for category,
    season, and accessory type detection from `tagger.py`
  - `body_type` (121 rows) — `BODY_TYPE_PREFERENCES` silhouette rules; keyed as
    `category_attribute` (e.g. `tops_fit`, `bottoms_leg_opening`) with `category = body_type_name`
  - `event_token` (38 rows) — activity and setting tokens with `jaccard_weight` in `meta`;
    25 activity tokens (weight 3.0) + 14 setting tokens (weight 2.0) for weighted Jaccard scoring
- `idx_style_taxonomy_domain` and `idx_style_taxonomy_domain_cat` performance indexes
- `style_taxonomy_updated_at` trigger using existing `set_updated_at()` function
- `idx_clothing_items_user_active` and `idx_clothing_items_trash` partial indexes
  for soft-delete query performance (was given ad-hoc in v1.8.0, now formally in migrations)

### Changed
- `services/taxonomy.py` — new process-level taxonomy loader backed by `style_taxonomy`:
  - `get_descriptors()`, `get_color_rgb()`, `get_clip_labels()`, `get_body_type_prefs()`,
    `get_event_tokens()` — each function hits the DB once, caches result with `lru_cache`,
    and falls back to the hardcoded Python constants if the DB is unreachable
  - `_parse_meta()` helper handles both pre-parsed `dict` (Supabase client) and raw JSON string
  - `invalidate_cache()` utility clears all five caches (call after admin writes to taxonomy)
  - **Mock mode**: skips DB entirely and returns the module-level Python constants directly —
    mock tests require no DB connection
- `ml/llm.py` — `describe_clothing()` now calls `get_descriptors()` to resolve clothing
  attribute vocabulary at runtime instead of reading the module-level dict directly;
  new descriptor values added to `style_taxonomy` are picked up without a deploy
- `ml/tagger.py` — `tag_clothing_image()` and `get_taggable_options()` now call
  `get_clip_labels()` to resolve CATEGORY, COLOR, SEASON, and ACCESSORY zero-shot prompts at
  runtime; `SEASON_DESCRIPTIONS` now uses `.get(v, v)` to handle future novel season values
- `services/recommender.py` — `score_color_harmony()` and `classify_color_story()` call
  `get_color_rgb()` at runtime; `score_body_type()` calls `get_body_type_prefs()` — both
  resolve from DB in real mode so wardrobe vocabulary expansions take effect immediately
- `routers/recommendations.py` — `_weighted_jaccard()` fetches activity and setting token sets
  via `get_event_tokens()` instead of reading module-level sets; jaccard weights now extensible
  by inserting new rows into `style_taxonomy` without redeployment

### Fixed
- `NULL` category rows in seed data replaced with `''` (empty string) — `UNIQUE` constraints
  and `ON CONFLICT` clauses do not resolve correctly on nullable columns in PostgreSQL;
  empty string sentinel ensures idempotent re-runs work as expected

---

## [1.9.0] - 2026-03-30

### Added

#### V2 Outfit-Level Scorer (`recommender.py`)
- Replaced independent per-item scoring with a **composed outfit-level formula** that
  judges the look as a whole: `Score = 0.28C + 0.24A + 0.22P + 0.10T + 0.08N + 0.05D − 0.03R`
- `WEIGHTS_V2` dict + `RISK_WEIGHT = 0.03` constants; v1 `WEIGHTS` retained as fallback

**C — Compatibility (`score_compatibility`)**
- `classify_color_story()` — classifies outfit palette into: neutral base + accent (0.92),
  all neutrals (0.88), monochromatic (0.86), analogous/tonal (0.84), complementary contrast
  (0.80), mixed (0.70), clashing (0.58); returns a human-readable tag used in explanations
- `score_silhouette_balance()` — scores proportion using the classic contrast rule: one
  oversized + one fitted = 0.95 ("balanced proportion — volume contrasted with fitted"),
  all fitted = 0.88, double oversized = 0.55 ("double-volume risk"); `_OVERSIZED_FITS`
  extended to include `wide`, `wide-leg`, `flare`, `flared`, `bootcut`, `barrel`, `voluminous`
  so wide-leg trousers correctly trigger the proportion contrast bonus
- `score_pairwise_compatibility()` — scores each item pair on color harmony (60%) +
  inter-item formality match (40%); outfit-level score is the average across all pairs

**A — Appropriateness (`score_appropriateness_v2`)**
- Extends v1 formality + season scoring with venue fit from `event_tokens`:
  heels penalised at outdoor events (beach, rooftop, park), athletic/loungewear penalised
  at formal events (wedding, gala, cocktail); returns labelled reason tag

**N — Novelty (`score_novelty`)**
- `1 − max_cosine_similarity(current_outfit_embedding, past_outfit_embeddings)`;
  past outfit embeddings computed on-the-fly from `seen_item_combos` (IDs already loaded,
  no extra DB query); defaults to 0.80 (below max) for new users

**D — Diversity/completeness (`score_diversity_completeness`)**
- Rewards outfits that cover expected slots: complete layered look = 0.95, complete
  look = 0.85, missing footwear = 0.65, incomplete = 0.50

**R — Risk penalty (`score_risk_penalty`)**
- Subtracts up to 0.50 for: athletic piece at formal event (+0.25 each),
  over-dressed for casual occasion (+0.12 each), low-confidence item data (+0.04 each)

**T — Trend (placeholder)**
- Neutral 0.50 for all outfits; pipeline deferred to v2.1 when external trend sources
  (Pinterest Predicts, WGSN) are integrated

**`score_outfit_v2()`**
- New main scorer; returns `(composite_score, score_breakdown)` where `score_breakdown`
  includes all component scores and a `tags` dict (color_story, silhouette, occasion,
  completeness, risk) used to seed the LLM explanation
- `generate_outfit_suggestions()` updated to use `score_outfit_v2`; now builds past
  outfit embeddings from `seen_item_combos` for novelty scoring; appends `score_breakdown`
  to each suggestion dict; strips `score_breakdown` before DB insert (not a DB column)

#### Grounded LLM Explanations (`llm.py`)
- `explain_outfit()` accepts new `score_breakdown: dict | None` parameter
- Real mode: prompt seeded with structured scoring signals ("Color story: neutral base
  with navy accent", "Proportion: balanced proportion — volume contrasted with fitted",
  "Occasion fit: strong formality match"); LLM instructed to reference these specifically
  rather than generate generic praise
- Mock mode: `_mock_explain_outfit()` assembles explanation from breakdown tags for
  richer, consistent test output
- Legacy `coherence_score` parameter retained as fallback when breakdown is absent

### Deferred
- Trend pipeline (v2.1) — `T` score is neutral placeholder until Pinterest/WGSN data available
- User style embedding (v2.0) — `P` score still uses feedback history + body-type priors;
  learned outfit-level user embedding deferred until sufficient rating data exists

---

## [1.8.1] - 2026-03-30

### Added

#### Restore Duplicate Guard
- `restore_item()` return type changed from `bool` to `RestoreResult` — a
  `Literal["restored", "not_found", "duplicate_conflict", "auto_purged"]` string;
  all callers pattern-match on this value
- Before restoring a trashed item, the service now checks for an active duplicate:
  - Real mode: embedding cosine similarity ≥ `DUPLICATE_THRESHOLD` (0.95) — same
    threshold used by upload duplicate detection
  - Mock mode: exact `category + color + item_type` match (mock embeddings are random)
- **Timestamp tiebreak** determines the outcome when a duplicate is found:
  - `active.created_at ≥ trash.created_at` → the active item is a replacement →
    trash item is **auto-purged** (DB row + storage file hard-deleted); response
    `status: "auto_purged"`
  - `active.created_at < trash.created_at` → the trashed item is newer, unusual
    case → **409 Conflict** returned; user must remove the active item manually first
- `POST /clothing/item/{id}/restore` now returns `{"status": "restored"|"auto_purged", "item_id": "..."}`
  instead of `{"restored": true}`
- `RestoreStatus` TypeScript type exported from `api.ts`; `restoreClothingItem()` now
  returns `Promise<RestoreStatus>` instead of `Promise<void>`
- Three distinct toast messages in `wardrobe.tsx`:
  - `"restored"` → "Item restored to wardrobe"
  - `"auto_purged"` → "A newer version of this item is already in your wardrobe — old copy removed" (info icon, 4 s)
  - 409 conflict → "A similar item is already in your wardrobe. Remove it first if you want to restore this one." (error, 5 s)

#### 90-Day Auto-Purge (Season-Aligned)
- `purge_old_deleted_items(user_id, days=90)` added to `clothing_service.py`:
  - Fetches all trash items with `deleted_at < now() - 90 days`
  - Removes storage files first (non-blocking, logs warnings on failure)
  - Hard-deletes DB rows; returns count of purged items
  - Both mock and real implementations
- `POST /clothing/purge-deleted` endpoint — idempotent, safe to call repeatedly;
  returns `{"purged": <count>}`. Intended as the target for an external cron job
- `supabase_migrations.sql` updated with two documented options for scheduling the purge:
  - **Option A** (pg_cron): SQL cron job running daily at 03:00 UTC — purges DB rows
    only (storage cleanup still requires the backend endpoint)
  - **Option B** (recommended): external cron service calls `POST /clothing/purge-deleted`
    — handles both DB rows and storage files atomically
- 90-day window is semantically aligned with one season change — items deleted in
  winter survive through spring before being permanently removed

### Changed
- `POST /clothing/item/{id}/restore` response body changed:
  `{"restored": true}` → `{"status": "restored"|"auto_purged", "item_id": "..."}`
- `restoreClothingItem()` in `api.ts` now returns `Promise<RestoreStatus>` (was `Promise<void>`)

---

## [1.8.0] - 2026-03-30

### Added

#### Wardrobe Soft Delete & Restore
- `DELETE /clothing/item/{id}` now soft-deletes items (sets `is_active=False`,
  records `deleted_at`) instead of permanently removing the record from the database;
  the storage image is preserved so items can be fully restored
- `GET /clothing/items/deleted` — returns all soft-deleted items for the authenticated
  user, ordered by most recently deleted; used to populate the Trash view
- `POST /clothing/item/{id}/restore` — sets `is_active=True`, clears `deleted_at`;
  returns `{"restored": true, "item_id": "..."}` on success
- `soft_delete()` helper added to `utils/mock_db_store.py` — sets `is_active=False`
  and `deleted_at` in the in-memory store, mirroring the Supabase behaviour in mock mode
- `get_deleted_items()` and `restore_item()` added to `clothing_service.py` with both
  mock and real implementations; `get_user_items()` now filters `is_active=True` in
  both modes (previously returned all rows regardless of soft-delete state)
- Wardrobe **Trash toggle** button in `wardrobe.tsx` header — visible only when at
  least one item has been soft-deleted; shows count badge; amber highlight when active
- Trash grid view in `wardrobe.tsx` — faded item cards with a gold **Restore** button
  per item; restoring immediately moves the item back into the active wardrobe and
  updates both state slices without a full page reload
- `handleDelete()` now shows `"Moved to trash — restore any time"` toast and
  optimistically moves the item into `deletedItems` state
- `handleRestore()` handler — calls `restoreClothingItem()`, removes item from
  `deletedItems` state and prepends to `items` state
- `getDeletedItems()` and `restoreClothingItem()` added to `frontend/services/api.ts`
- `RotateCcw` icon from lucide-react used for the Restore button

#### Smarter Outfit Explanations
- `explain_outfit()` public interface extended with two optional params:
  - `user_body_type: str | None` — when set, the real-mode prompt instructs the
    model to reference how the silhouette or fit choice flatters the user's proportions
  - `coherence_score: float | None` — when ≥ 0.90 the prompt highlights pattern
    harmony; when ≤ 0.55 it acknowledges pattern mixing as a deliberate bold choice
- `_real_explain_outfit()` prompt rewritten: items now include descriptor details
  (fit, neckline, pattern) for richer context; formality shown as a percentage;
  prompt now speaks directly to the wearer ("you" / "your"); `max_tokens=120` cap
  added to keep costs stable
- `_item_line()` inner helper serialises an item's color, category, fit, neckline
  and pattern into a compact `|`-delimited string for the prompt
- `score_style_coherence()` is now called at the outfit assembly site in
  `recommender.py` and its result is forwarded to `explain_outfit()` as
  `coherence_score` — no extra DB round-trip
- Two body-type aware mock explanations added to `_MOCK_EXPLANATIONS` in `llm.py`
  so body-type logic is exercisable in mock mode

#### Wardrobe Coverage Nudge
- `wardrobe_coverage_gaps(user_items)` helper added to `recommender.py` — analyses
  which of the four outfit templates (A: top+bottom+shoes, B: top+bottom+outer+shoes,
  C: dress+shoes, D: dress+outer+shoes) the current wardrobe can satisfy; returns a
  plain-English list of actionable hints only when something meaningful is missing
- Hints are returned alongside every `POST /recommend/generate-outfits` response as
  `coverage_hints: List[str]` — empty list when the wardrobe covers at least one full
  template family
- `OutfitsResponse` TypeScript interface extended with `coverage_hints?: string[]`
- **"Unlock more looks"** amber banner rendered in `events.tsx` below the regenerate
  buttons when `coverage_hints` is non-empty; each hint prefixed with a `✦` gold
  marker matching the Editorial Dark aesthetic; banner only shows after generation
  so it never blocks the initial input flow

### Changed
- `DELETE /clothing/item/{id}` changed from hard delete (removes row + storage file)
  to soft delete (marks `is_active=False`, preserves storage); storage files are now
  retained until an explicit hard-delete (future admin feature)
- `get_user_items()` in both mock and real mode now filters `is_active=True`; items
  moved to trash are invisible to the recommender and the wardrobe grid
- `explain_outfit()` signature extended — existing callers that omit the new optional
  params continue to work unchanged (both default to `None`)
- Wardrobe delete toast updated from `"Item removed"` to
  `"Moved to trash — restore any time"`

### Deferred
- Coverage nudge for accessories (bags, belts, scarves) — current logic only checks
  core structural item types; accessory gap detection deferred to a later version

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
