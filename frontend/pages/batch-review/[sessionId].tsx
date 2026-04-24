/**
 * pages/batch-review/[sessionId].tsx — Batch Review
 * ===================================================
 * Shows all items in a batch upload session.  Users can:
 *   • Click an item to edit its AI tags (reuses WardrobeItemEditor)
 *   • Verify an item (marks clothing_item verified → enters recommendations)
 *   • Reject an item (removes the linked clothing item from wardrobe)
 *
 * The edit flow calls correctItem() then verifyBatchUploadItem() so corrections
 * are saved before the trust flag is set.
 */

import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Link from "next/link";
import { AlertCircle, CheckCircle, ChevronLeft, Loader, Pencil, X } from "lucide-react";
import toast from "react-hot-toast";
import Navbar from "@/components/layout/Navbar";
import WardrobeItemEditor from "@/components/WardrobeItemEditor";
import {
  getBatchUploadSession,
  getWardrobeMediaStatus,
  getTagOptions,
  correctItem,
  verifyBatchUploadItem,
  rejectBatchUploadItem,
  BatchSessionWithItems,
  BatchItem,
  ClothingItem,
  TagOptions,
} from "@/services/api";
import { getItemDisplayName } from "@/utils/itemDisplay";

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_TAG_OPTIONS: TagOptions = {
  categories: [], colors: [], seasons: [], formality_levels: [],
};

function debugBatchReview(event: string, details?: Record<string, unknown>) {
  if (details) console.debug(`[BatchUpload][Review] ${event}`, details);
  else console.debug(`[BatchUpload][Review] ${event}`);
}

function sessionSummaryLine(session: BatchSessionWithItems): string {
  const parts: string[] = [];
  if (session.awaiting_verification_count > 0)
    parts.push(`${session.awaiting_verification_count} awaiting review`);
  if (session.verified_count > 0)
    parts.push(`${session.verified_count} verified`);
  if (session.failed_count > 0)
    parts.push(`${session.failed_count} failed`);
  return parts.join(" · ") || "No items yet";
}

function broadcastWardrobeItemRemoved(itemId: string) {
  if (typeof window === "undefined") return;
  const payload = { type: "item_removed", itemId, at: Date.now() };
  window.localStorage.setItem("luxelook:wardrobe-sync", JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent("luxelook:wardrobe-sync", { detail: payload }));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BatchReviewPage() {
  const router    = useRouter();
  const sessionId = router.query.sessionId as string | undefined;

  const [session,       setSession]       = useState<BatchSessionWithItems | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [tagOptions,    setTagOptions]    = useState<TagOptions>(EMPTY_TAG_OPTIONS);
  const [tagOptLoading, setTagOptLoading] = useState(false);
  const [tagOptLoaded,  setTagOptLoaded]  = useState(false);
  const [clothingItemMap, setClothingItemMap] = useState<Record<string, ClothingItem>>({});

  // Which batch item is open in the editor
  const [editingBatchItem, setEditingBatchItem] = useState<BatchItem | null>(null);
  // Synthetic ClothingItem built from batch item for the editor
  const [editingClothingItem, setEditingClothingItem] = useState<ClothingItem | null>(null);

  // ── Load session ──────────────────────────────────────────────────────────

  const loadSession = useCallback(async (id: string) => {
    try {
      const s = await getBatchUploadSession(id);
      setSession(s);
      const clothingIds = Array.from(
        new Set(
          s.items
            .map((item) => item.clothing_item_id)
            .filter((value): value is string => Boolean(value))
        )
      );
      if (clothingIds.length > 0) {
        const clothingItems = await getWardrobeMediaStatus(clothingIds, true);
        setClothingItemMap(
          Object.fromEntries(clothingItems.map((item) => [item.id, item]))
        );
      } else {
        setClothingItemMap({});
      }
      debugBatchReview("session_loaded", {
        sessionId: id,
        status: s.status,
        itemCount: s.items.length,
        awaiting: s.awaiting_verification_count,
        verified: s.verified_count,
        failed: s.failed_count,
        clothingItems: clothingIds.length,
      });
    } catch {
      toast.error("Could not load this review session");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionId) void loadSession(sessionId);
  }, [sessionId, loadSession]);

  // ── Tag options ───────────────────────────────────────────────────────────

  const ensureTagOptions = useCallback(async () => {
    if (tagOptLoaded || tagOptLoading) return;
    setTagOptLoading(true);
    try {
      const opts = await getTagOptions();
      setTagOptions(opts);
      setTagOptLoaded(true);
      debugBatchReview("tag_options_loaded", {
        categories: opts.categories.length,
        colors: opts.colors.length,
        seasons: opts.seasons.length,
        formalityLevels: opts.formality_levels.length,
      });
    } catch {
      toast.error("Failed to load tag options");
    } finally {
      setTagOptLoading(false);
    }
  }, [tagOptLoaded, tagOptLoading]);

  // ── Open editor for a batch item ──────────────────────────────────────────

  function openEditor(batchItem: BatchItem) {
    if (!batchItem.clothing_item_id) {
      toast.error("This item hasn't been tagged yet — try again in a moment");
      return;
    }

    const linkedClothingItem = clothingItemMap[batchItem.clothing_item_id];
    const ci: ClothingItem = linkedClothingItem || {
      id:            batchItem.clothing_item_id!,
      user_id:       batchItem.user_id,
      category:      "tops",
      item_type:     "core_garment",
      image_url:     batchItem.image_url    || "",
      thumbnail_url: batchItem.thumbnail_url ?? undefined,
      cutout_url:    batchItem.cutout_url    ?? undefined,
      created_at:    batchItem.created_at,
      descriptors:   {},
    };

    setEditingBatchItem(batchItem);
    setEditingClothingItem(ci);
    debugBatchReview("editor_opened", { batchItemId: batchItem.id, clothingItemId: batchItem.clothing_item_id, status: batchItem.status });
    void ensureTagOptions();
  }

  function closeEditor() {
    debugBatchReview("editor_closed", { batchItemId: editingBatchItem?.id });
    setEditingBatchItem(null);
    setEditingClothingItem(null);
  }

  // ── Save + verify flow ────────────────────────────────────────────────────

  async function handleSaveAndVerify(
    cat: string, color: string, pattern: string,
    season: string, formalityLabel: string, descriptors: Record<string, string>
  ) {
    if (!editingBatchItem || !editingClothingItem) return;
    const batchItemId   = editingBatchItem.id;
    const clothingItemId = editingClothingItem.id;
    debugBatchReview("save_and_verify_started", {
      batchItemId,
      clothingItemId,
      category: cat,
      color,
      season,
      formalityLabel,
      descriptorCount: Object.keys(descriptors).length,
    });
    closeEditor();

    try {
      // 1. Apply tag corrections
      await correctItem(clothingItemId, { category: cat, color, pattern, season, formality_label: formalityLabel, descriptors });
      // 2. Mark verified
      await verifyBatchUploadItem(batchItemId);
      toast.success("Item verified and saved to wardrobe!");
      if (sessionId) await loadSession(sessionId);
      debugBatchReview("save_and_verify_succeeded", { batchItemId, clothingItemId });
    } catch {
      toast.error("Could not verify item — please try again");
      debugBatchReview("save_and_verify_failed", { batchItemId, clothingItemId });
    }
  }

  async function handleVerify(batchItem: BatchItem) {
    if (!batchItem.clothing_item_id) return;
    debugBatchReview("verify_started", { batchItemId: batchItem.id, clothingItemId: batchItem.clothing_item_id });
    try {
      await verifyBatchUploadItem(batchItem.id);
      toast.success("Verified!");
      if (sessionId) await loadSession(sessionId);
      debugBatchReview("verify_succeeded", { batchItemId: batchItem.id });
    } catch {
      toast.error("Could not verify item");
      debugBatchReview("verify_failed", { batchItemId: batchItem.id });
    }
  }

  async function handleReject(batchItem: BatchItem) {
    debugBatchReview("reject_started", { batchItemId: batchItem.id, clothingItemId: batchItem.clothing_item_id });
    try {
      await rejectBatchUploadItem(batchItem.id);
      if (batchItem.clothing_item_id) {
        broadcastWardrobeItemRemoved(batchItem.clothing_item_id);
      }
      toast("Item rejected — removed from wardrobe", { icon: "🗑️" });
      if (sessionId) await loadSession(sessionId);
      debugBatchReview("reject_succeeded", { batchItemId: batchItem.id });
    } catch {
      toast.error("Could not reject item");
      debugBatchReview("reject_failed", { batchItemId: batchItem.id });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Head><title>Batch Review — LuxeLook AI</title></Head>
        <Navbar />
        <main className="page-main" style={{ maxWidth: "1200px", margin: "0 auto", padding: "48px 24px", textAlign: "center" }}>
          <Loader size={32} color="var(--gold)" style={{ animation: "spin 1s linear infinite" }} />
        </main>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <Head><title>Batch Review — LuxeLook AI</title></Head>
        <Navbar />
        <main className="page-main" style={{ maxWidth: "1200px", margin: "0 auto", padding: "48px 24px", textAlign: "center" }}>
          <AlertCircle size={32} color="var(--muted)" style={{ marginBottom: "12px" }} />
          <p style={{ color: "var(--muted)" }}>Session not found.</p>
          <Link href="/batch-upload" style={{ color: "var(--gold)", marginTop: "12px", display: "inline-block" }}>
            ← Back to Batch Upload
          </Link>
        </main>
      </>
    );
  }

  const pendingItems  = session.items.filter((i) => i.status === "awaiting_verification");
  const doneItems     = session.items.filter((i) => i.status === "verified" || i.status === "rejected");
  const processingItems = session.items.filter((i) => ["queued","uploaded","tagging","tagged"].includes(i.status));
  const failedItems   = session.items.filter((i) => i.status === "failed");

  return (
    <>
      <Head><title>Batch Review — LuxeLook AI</title></Head>
      <Navbar />

      <main className="page-main" style={{ maxWidth: "1200px", margin: "0 auto", padding: "48px 24px" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: "32px" }}>
          <Link href="/batch-upload" style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "13px", color: "var(--muted)", textDecoration: "none", marginBottom: "16px" }}>
            <ChevronLeft size={14} /> Batch Upload
          </Link>
          <h1 className="type-page-title" style={{ fontSize: "32px", marginBottom: "8px" }}>Review Uploads</h1>
          <p className="type-body" style={{ color: "var(--muted)", fontSize: "14px" }}>
            {sessionSummaryLine(session)}
            {" · "}
            {new Date(session.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>

        {/* ── Still processing notice ── */}
        {processingItems.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: "10px",
            padding: "14px 18px", borderRadius: "10px", marginBottom: "24px",
            background: "rgba(212,169,106,0.08)", border: "1px solid rgba(212,169,106,0.25)",
          }}>
            <Loader size={16} color="var(--gold)" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
            <p style={{ fontSize: "13px", color: "var(--gold)" }}>
              {processingItems.length} item{processingItems.length !== 1 ? "s are" : " is"} still being tagged — refresh in a moment.
            </p>
            <button
              onClick={() => sessionId && void loadSession(sessionId)}
              style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--gold)", cursor: "pointer", fontSize: "13px", padding: "0" }}
            >
              Refresh
            </button>
          </div>
        )}

        {/* ── Items awaiting verification ── */}
        {pendingItems.length > 0 && (
          <section style={{ marginBottom: "36px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 600, color: "var(--charcoal)", marginBottom: "16px" }}>
              Needs review ({pendingItems.length})
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>
              {pendingItems.map((item) => (
                <BatchItemCard
                  key={item.id}
                  item={item}
                  clothingItem={item.clothing_item_id ? clothingItemMap[item.clothing_item_id] : undefined}
                  onEdit={() => openEditor(item)}
                  onVerify={() => void handleVerify(item)}
                  onReject={() => void handleReject(item)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Still processing ── */}
        {processingItems.length > 0 && (
          <section style={{ marginBottom: "36px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 600, color: "var(--charcoal)", marginBottom: "16px" }}>
              Processing ({processingItems.length})
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>
              {processingItems.map((item) => (
                <BatchItemCard key={item.id} item={item} clothingItem={item.clothing_item_id ? clothingItemMap[item.clothing_item_id] : undefined} processing />
              ))}
            </div>
          </section>
        )}

        {/* ── Failed items ── */}
        {failedItems.length > 0 && (
          <section style={{ marginBottom: "36px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#F87171", marginBottom: "16px" }}>
              Failed ({failedItems.length})
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>
              {failedItems.map((item) => (
                <BatchItemCard key={item.id} item={item} clothingItem={item.clothing_item_id ? clothingItemMap[item.clothing_item_id] : undefined} />
              ))}
            </div>
          </section>
        )}

        {/* ── Completed items ── */}
        {doneItems.length > 0 && (
          <section>
            <h2 style={{ fontSize: "15px", fontWeight: 600, color: "var(--muted)", marginBottom: "16px" }}>
              Completed ({doneItems.length})
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>
              {doneItems.map((item) => (
                <BatchItemCard key={item.id} item={item} clothingItem={item.clothing_item_id ? clothingItemMap[item.clothing_item_id] : undefined} />
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {session.items.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 24px", color: "var(--muted)" }}>
            <p>No items in this session yet.</p>
            <Link href="/batch-upload" style={{ color: "var(--gold)", marginTop: "8px", display: "inline-block" }}>
              ← Back to Batch Upload
            </Link>
          </div>
        )}

        {/* Wardrobe CTA when all done */}
        {pendingItems.length === 0 && processingItems.length === 0 && session.verified_count > 0 && (
          <div style={{ marginTop: "36px", padding: "24px", borderRadius: "12px", background: "var(--input-bg)", border: "1px solid var(--border)", textAlign: "center" }}>
            <CheckCircle size={24} color="var(--gold)" style={{ marginBottom: "8px" }} />
            <p style={{ fontWeight: 600, marginBottom: "4px" }}>All done!</p>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "16px" }}>
              {session.verified_count} verified item{session.verified_count !== 1 ? "s are" : " is"} now in your wardrobe.
            </p>
            <Link href="/wardrobe" className="btn-primary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}>
              Go to Wardrobe
            </Link>
          </div>
        )}
      </main>

      {/* ── Edit modal ── */}
      {editingBatchItem && editingClothingItem && (
        <WardrobeItemEditor
          item={editingClothingItem}
          tagOptions={tagOptions}
          tagOptionsLoading={tagOptLoading}
          onRequestTagOptions={ensureTagOptions}
          onClose={closeEditor}
          onSave={(cat, color, pattern, season, formalityLabel, descriptors) =>
            void handleSaveAndVerify(cat, color, pattern, season, formalityLabel, descriptors)
          }
          extraActions={
            <>
              <button
                type="button"
                className="btn-secondary"
                style={{ color: "#F87171", borderColor: "rgba(248,113,113,0.4)" }}
                onClick={() => {
                  const bi = editingBatchItem;
                  closeEditor();
                  void handleReject(bi);
                }}
              >
                Reject
              </button>
            </>
          }
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

// ── BatchItemCard ─────────────────────────────────────────────────────────────

function BatchItemCard({
  item,
  clothingItem,
  onEdit,
  onVerify,
  onReject,
  processing = false,
}: {
  item: BatchItem;
  clothingItem?: ClothingItem;
  onEdit?: () => void;
  onVerify?: () => void;
  onReject?: () => void;
  processing?: boolean;
}) {
  const imgSrc = clothingItem?.thumbnail_url || clothingItem?.image_url || item.thumbnail_url || item.image_url;
  const isActionable = item.status === "awaiting_verification";
  const isDone = item.status === "verified" || item.status === "rejected";
  const displayName = clothingItem ? getItemDisplayName(clothingItem) : (item.file_name || "Uploaded image");
  const descriptorValues = clothingItem?.descriptors ? Object.values(clothingItem.descriptors).filter(Boolean) : [];
  const uniqueDescriptorValues = Array.from(new Set(descriptorValues.map((value) => String(value).trim()).filter(Boolean)));
  const formalityLabel =
    clothingItem?.formality_score !== undefined
      ? clothingItem.formality_score >= 0.85 ? "Black Tie"
      : clothingItem.formality_score >= 0.78 ? "Cocktail"
      : clothingItem.formality_score >= 0.68 ? "Business Formal"
      : clothingItem.formality_score >= 0.55 ? "Business Casual"
      : clothingItem.formality_score >= 0.42 ? "Smart Casual"
      : clothingItem.formality_score >= 0.20 ? "Casual"
      : "Loungewear"
      : null;

  return (
    <div
      className="card"
      style={{
        padding: 0, overflow: "hidden",
        opacity: isDone ? 0.7 : 1,
        transition: "opacity 0.2s ease",
      }}
    >
      {/* Image */}
      <div style={{ width: "100%", aspectRatio: "3/4", position: "relative", background: "var(--input-bg)" }}>
        {imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgSrc} alt={item.file_name || "item"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {processing
              ? <Loader size={24} color="var(--gold)" style={{ animation: "spin 1s linear infinite" }} />
              : <div style={{ fontSize: "12px", color: "var(--muted)", textAlign: "center", padding: "12px" }}>No preview</div>
            }
          </div>
        )}

        {/* Status badge */}
        <div style={{
          position: "absolute", top: "8px", left: "8px",
          padding: "3px 8px", borderRadius: "6px",
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          fontSize: "10px", fontWeight: 600, color: itemStatusColor(item.status),
          textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          {itemStatusLabel(item.status)}
        </div>

        {/* Edit button (only for actionable items) */}
        {isActionable && onEdit && (
          <button
            onClick={onEdit}
            title="Edit tags"
            style={{
              position: "absolute", top: "8px", right: "8px",
              background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "6px",
              width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "white",
            }}
          >
            <Pencil size={13} />
          </button>
        )}
      </div>

      {/* Actions */}
      <div style={{ padding: "12px" }}>
        <p style={{ fontWeight: 500, fontSize: "14px", textTransform: "capitalize", marginBottom: "4px", color: "var(--charcoal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayName}
        </p>
        <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.file_name || "Uploaded image"}
        </p>

        {clothingItem && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginBottom: "8px" }}>
            {clothingItem.category && (
              <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "capitalize" }}>
                {clothingItem.category}
              </span>
            )}
            {clothingItem.season && (
              <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "capitalize" }}>
                {clothingItem.season}
              </span>
            )}
            {formalityLabel && (
              <span
                style={{
                  fontSize: "10px",
                  padding: "2px 8px",
                  borderRadius: "20px",
                  background: (clothingItem.formality_score || 0) > 0.6 ? "rgba(212,169,106,0.12)" : "rgba(122,148,104,0.15)",
                  color: (clothingItem.formality_score || 0) > 0.6 ? "var(--charcoal)" : "var(--sage)",
                }}
              >
                {formalityLabel}
              </span>
            )}
          </div>
        )}

        {uniqueDescriptorValues.length > 0 && (
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "10px" }}>
            {uniqueDescriptorValues.slice(0, 6).map((val, i) => (
              <span
                key={`${item.id}-desc-${i}`}
                style={{
                  fontSize: "10px",
                  padding: "2px 8px",
                  borderRadius: "20px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--muted)",
                  textTransform: "capitalize",
                }}
              >
                {val}
              </span>
            ))}
          </div>
        )}

        {item.status === "failed" && item.error_message && (
          <p style={{ fontSize: "11px", color: "#F87171", marginBottom: "8px", lineHeight: 1.4 }}>
            {item.error_message.slice(0, 80)}
          </p>
        )}

        {isActionable && (
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={onVerify}
              style={{
                flex: 1, fontSize: "12px", fontWeight: 600,
                padding: "7px 0", borderRadius: "6px",
                border: "none", background: "var(--gold)",
                color: "white", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
              }}
            >
              <CheckCircle size={12} /> Verify
            </button>
            <button
              onClick={onReject}
              style={{
                flex: 1, fontSize: "12px",
                padding: "7px 0", borderRadius: "6px",
                border: "1px solid rgba(248,113,113,0.4)",
                background: "rgba(248,113,113,0.08)",
                color: "#F87171", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
              }}
            >
              <X size={12} /> Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function itemStatusColor(status: BatchItem["status"]): string {
  if (status === "verified")              return "var(--gold)";
  if (status === "awaiting_verification") return "#86EFAC";
  if (status === "rejected")              return "#F87171";
  if (status === "failed")               return "#F87171";
  if (status === "tagging")              return "rgba(212,169,106,0.8)";
  return "rgba(255,255,255,0.6)";
}

function itemStatusLabel(status: BatchItem["status"]): string {
  return {
    queued:                "Queued",
    uploaded:              "Uploaded",
    tagging:               "Tagging…",
    tagged:                "Tagged",
    awaiting_verification: "Review",
    verified:              "✓ Verified",
    rejected:              "Rejected",
    failed:                "Failed",
  }[status] ?? status;
}
