/**
 * pages/batch-upload.tsx — Batch Wardrobe Upload
 * ================================================
 * Upload up to 5 clothing photos at once.  AI tags them in the background.
 * No inline tag-edit modal here — review happens on the Batch Review page.
 *
 * Flow:
 *   1. User selects 1–5 images.
 *   2. On "Start upload", a session is created.
 *   3. Images are uploaded sequentially (one at a time to keep load manageable).
 *   4. Frontend polls session status every 3 s until processing stabilises.
 *   5. A CTA navigates to /batch-review/[sessionId].
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { CheckCircle, Loader, Upload, X, AlertCircle, Layers } from "lucide-react";
import toast from "react-hot-toast";
import Navbar from "@/components/layout/Navbar";
import {
  createBatchUploadSession,
  uploadBatchItem,
  getBatchUploadSession,
  listBatchUploadSessions,
  BatchSession,
  BatchSessionWithItems,
  BatchItemStatus,
} from "@/services/api";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILES = 5;
const POLL_INTERVAL_MS = 3000;

const TERMINAL_SESSION_STATUSES = new Set([
  "completed",
  "completed_with_errors",
]);

function debugBatchUpload(event: string, details?: Record<string, unknown>) {
  if (details) console.debug(`[BatchUpload][Page] ${event}`, details);
  else console.debug(`[BatchUpload][Page] ${event}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusLabel(s: string): string {
  return {
    queued:                 "Queued",
    uploading:              "Uploading…",
    processing:             "AI tagging…",
    awaiting_verification:  "Ready to review",
    completed:              "Done",
    completed_with_errors:  "Done (some failed)",
  }[s] ?? s;
}

function itemStatusIcon(s: BatchItemStatus) {
  if (s === "verified" || s === "tagged" || s === "awaiting_verification")
    return <CheckCircle size={14} color="var(--gold)" />;
  if (s === "failed")
    return <AlertCircle size={14} color="#F87171" />;
  return <Loader size={14} color="var(--muted)" style={{ animation: "spin 1s linear infinite" }} />;
}

function itemStatusText(s: BatchItemStatus): string {
  return {
    queued:                "Queued",
    uploaded:              "Uploaded",
    tagging:               "AI tagging…",
    tagged:                "Tagged",
    awaiting_verification: "Ready to review",
    verified:              "Verified",
    rejected:              "Rejected",
    failed:                "Failed",
  }[s] ?? s;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface LocalFile {
  file: File;
  previewUrl: string;
}

export default function BatchUploadPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [localFiles,    setLocalFiles]    = useState<LocalFile[]>([]);
  const [uploading,     setUploading]     = useState(false);
  const [session,       setSession]       = useState<BatchSessionWithItems | null>(null);
  const [recentSessions, setRecentSessions] = useState<BatchSession[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load recent sessions ──────────────────────────────────────────────────

  const loadRecentSessions = useCallback(async (quiet = false) => {
    try {
      const sessions = await listBatchUploadSessions(10);
      debugBatchUpload("recent_sessions_loaded", { count: sessions.length, quiet });
      setRecentSessions(sessions);
    } catch {
      // non-critical
    } finally {
      if (!quiet) setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    void loadRecentSessions(false);
    const intervalId = setInterval(() => {
      void loadRecentSessions(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [loadRecentSessions]);

  // ── Polling ───────────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback((sessionId: string) => {
    stopPolling();
    let lastSignature = "";
    pollingRef.current = setInterval(async () => {
      try {
        const updated = await getBatchUploadSession(sessionId);
        setSession(updated);
        const signature = `${updated.status}:${updated.awaiting_verification_count}:${updated.verified_count}:${updated.failed_count}:${updated.items.length}`;
        if (signature !== lastSignature) {
          lastSignature = signature;
          debugBatchUpload("poll_update", {
            sessionId,
            status: updated.status,
            items: updated.items.length,
            awaiting: updated.awaiting_verification_count,
            verified: updated.verified_count,
            failed: updated.failed_count,
          });
        }
        if (TERMINAL_SESSION_STATUSES.has(updated.status)) {
          debugBatchUpload("poll_stopped_terminal", { sessionId, status: updated.status });
          stopPolling();
        }
      } catch {
        // Keep polling; transient failure
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── File selection ────────────────────────────────────────────────────────

  function onFilesSelected(rawFiles: FileList | null) {
    if (!rawFiles) return;
    const accepted = Array.from(rawFiles)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, MAX_FILES);

    if (accepted.length === 0) {
      toast.error("Please select image files (jpg, png, webp)");
      return;
    }

    // Revoke old object URLs
    localFiles.forEach((lf) => URL.revokeObjectURL(lf.previewUrl));

    setLocalFiles(
      accepted.map((f) => ({ file: f, previewUrl: URL.createObjectURL(f) }))
    );
    debugBatchUpload("files_selected", {
      count: accepted.length,
      files: accepted.map((file) => ({ name: file.name, size: file.size, type: file.type })),
    });
    setSession(null);
  }

  function removeFile(index: number) {
    setLocalFiles((prev) => {
      debugBatchUpload("file_removed", { index, filename: prev[index]?.file.name });
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  // ── Upload flow ───────────────────────────────────────────────────────────

  async function handleStartUpload() {
    if (!localFiles.length || uploading) return;
    setUploading(true);
    debugBatchUpload("start_upload_clicked", { count: localFiles.length, files: localFiles.map(({ file }) => file.name) });

    try {
      // 1. Create session
      const newSession = await createBatchUploadSession(localFiles.length);
      const sessionId  = newSession.id;
      debugBatchUpload("session_created", { sessionId, status: newSession.status, totalCount: newSession.total_count });

      // Fetch the full session with items for initial state
      const full = await getBatchUploadSession(sessionId);
      setSession(full);
      debugBatchUpload("session_loaded_initial", { sessionId, status: full.status, itemCount: full.items.length });

      // 2. Upload sequentially — simpler and more reliable for small batches
      for (const { file } of localFiles) {
        try {
          debugBatchUpload("upload_item_begin", { sessionId, filename: file.name });
          await uploadBatchItem(sessionId, file);
          // Refresh session after each upload
          const updated = await getBatchUploadSession(sessionId);
          setSession(updated);
          debugBatchUpload("upload_item_complete", {
            sessionId,
            filename: file.name,
            status: updated.status,
            itemCount: updated.items.length,
          });
        } catch (err) {
          toast.error(`Upload failed for ${file.name}`);
          console.error("Batch item upload error:", err);
          debugBatchUpload("upload_item_failed", { sessionId, filename: file.name, error: err instanceof Error ? err.message : String(err) });
        }
      }

      // 3. Start polling for tagging completion
      startPolling(sessionId);
      debugBatchUpload("polling_started", { sessionId });

      // Revoke preview URLs — no longer needed
      localFiles.forEach((lf) => URL.revokeObjectURL(lf.previewUrl));
      setLocalFiles([]);

    } catch (err) {
      toast.error("Failed to start batch upload — please try again");
      console.error("Batch session creation error:", err);
      debugBatchUpload("session_creation_failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      setUploading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isProcessing = session && !TERMINAL_SESSION_STATUSES.has(session.status);
  const isReady      = session && (session.status === "awaiting_verification" || TERMINAL_SESSION_STATUSES.has(session.status));

  return (
    <>
      <Head><title>Batch Upload — LuxeLook AI</title></Head>
      <Navbar />

      <main className="page-main" style={{ maxWidth: "1200px", margin: "0 auto", padding: "48px 24px" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: "36px" }}>
          <h1 className="type-page-title" style={{ fontSize: "36px", marginBottom: "8px" }}>
            Batch Upload
          </h1>
          <p className="type-body" style={{ color: "var(--muted)", fontSize: "15px" }}>
            Upload up to {MAX_FILES} clothing photos at once. AI tags them in the background — review on the next page.
          </p>
        </div>

        {/* ── File picker — only when no active session ── */}
        {!session && (
          <div className="card" style={{ padding: "32px", marginBottom: "28px" }}>
            {/* Drop zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: "2px dashed var(--border)",
                borderRadius: "12px",
                padding: "40px 24px",
                textAlign: "center",
                cursor: "pointer",
                background: "var(--input-bg)",
                transition: "border-color 0.15s ease",
                marginBottom: "24px",
              }}
              onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = "var(--gold)"; }}
              onDragLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
              onDrop={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                onFilesSelected(e.dataTransfer.files);
              }}
            >
              <Upload size={32} color="var(--gold)" style={{ marginBottom: "12px" }} />
              <p style={{ fontWeight: 500, color: "var(--charcoal)", marginBottom: "4px" }}>
                Drag & drop up to {MAX_FILES} photos
              </p>
              <p className="type-helper" style={{ color: "var(--muted)", fontSize: "13px" }}>
                or click to browse · jpg, png, webp
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={(e) => onFilesSelected(e.target.files)}
              />
            </div>

            {/* Selected file thumbnails */}
            {localFiles.length > 0 && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "12px", marginBottom: "24px" }}>
                  {localFiles.map((lf, i) => (
                    <div key={i} style={{ position: "relative", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)", aspectRatio: "3/4" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={lf.previewUrl} alt={lf.file.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button
                        onClick={() => removeFile(i)}
                        style={{
                          position: "absolute", top: "4px", right: "4px",
                          background: "rgba(0,0,0,0.65)", border: "none", borderRadius: "50%",
                          width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", color: "white",
                        }}
                        title="Remove"
                      >
                        <X size={12} />
                      </button>
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.55)", padding: "4px 6px" }}>
                        <p style={{ fontSize: "10px", color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {lf.file.name}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {localFiles.length < MAX_FILES && (
                  <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "16px" }}>
                    {localFiles.length} / {MAX_FILES} selected · click the drop zone to add more
                  </p>
                )}

                <button
                  className="btn-primary"
                  onClick={handleStartUpload}
                  disabled={uploading}
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  {uploading ? (
                    <><Loader size={15} style={{ animation: "spin 1s linear infinite" }} /> Uploading…</>
                  ) : (
                    <><Upload size={15} /> Start upload ({localFiles.length} photo{localFiles.length !== 1 ? "s" : ""})</>
                  )}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Active session progress ── */}
        {session && (
          <div className="card fade-up" style={{ padding: "28px", marginBottom: "28px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: "16px", color: "var(--charcoal)", marginBottom: "4px" }}>
                  {statusLabel(session.status)}
                </p>
                <p style={{ fontSize: "13px", color: "var(--muted)" }}>
                  {session.processed_count} / {session.total_count} processed
                  {session.failed_count > 0 && ` · ${session.failed_count} failed`}
                </p>
              </div>
              {isProcessing && (
                <Loader size={20} color="var(--gold)" style={{ animation: "spin 1s linear infinite" }} />
              )}
              {isReady && (
                <CheckCircle size={20} color="var(--gold)" />
              )}
            </div>

            {/* Progress bar */}
            <div style={{ height: "6px", borderRadius: "3px", background: "var(--border)", marginBottom: "20px", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: "3px", background: "var(--gold)",
                width: `${Math.round((session.processed_count / Math.max(1, session.total_count)) * 100)}%`,
                transition: "width 0.4s ease",
              }} />
            </div>

            {/* Item rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
              {session.items.map((item) => (
                <div key={item.id} style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "10px 14px", borderRadius: "10px",
                  background: "var(--input-bg)", border: "1px solid var(--border)",
                }}>
                  {/* Thumbnail */}
                  {item.thumbnail_url || item.image_url ? (
                    <div style={{ width: "36px", height: "48px", borderRadius: "6px", overflow: "hidden", flexShrink: 0, position: "relative" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.thumbnail_url || item.image_url || ""}
                        alt={item.file_name || "item"}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </div>
                  ) : (
                    <div style={{ width: "36px", height: "48px", borderRadius: "6px", background: "var(--border)", flexShrink: 0 }} />
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--charcoal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.file_name || "Image"}
                    </p>
                    <p style={{ fontSize: "12px", color: item.status === "failed" ? "#F87171" : "var(--muted)" }}>
                      {item.error_message && item.status === "failed" ? item.error_message : itemStatusText(item.status)}
                    </p>
                  </div>
                  {itemStatusIcon(item.status)}
                </div>
              ))}
            </div>

            {/* Review CTA */}
            {isReady && session.awaiting_verification_count > 0 && (
              <Link
                href={`/batch-review/${session.id}`}
                className="btn-primary"
                style={{ display: "inline-flex", alignItems: "center", gap: "8px", textDecoration: "none" }}
              >
                <CheckCircle size={15} />
                Review {session.awaiting_verification_count} tagged item{session.awaiting_verification_count !== 1 ? "s" : ""}
              </Link>
            )}

            {/* Upload more */}
            {TERMINAL_SESSION_STATUSES.has(session.status) && (
              <button
                className="btn-secondary"
                style={{ marginTop: "12px", fontSize: "13px" }}
                onClick={() => setSession(null)}
              >
                Upload more photos
              </button>
            )}
          </div>
        )}

        {/* ── Recent sessions ── */}
        {!session && (
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--charcoal)", marginBottom: "16px" }}>
              Recent & in-progress uploads
            </h2>

            {loadingRecent ? (
              <div style={{ textAlign: "center", padding: "24px", color: "var(--muted)" }}>
                <Loader size={20} color="var(--gold)" style={{ animation: "spin 1s linear infinite" }} />
              </div>
            ) : recentSessions.length === 0 ? (
              <div style={{
                padding: "32px", textAlign: "center", border: "1px dashed var(--border)",
                borderRadius: "12px", color: "var(--muted)",
              }}>
                <Layers size={28} style={{ marginBottom: "8px", opacity: 0.5 }} />
                <p style={{ fontSize: "14px" }}>No batch uploads yet</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {recentSessions.map((s) => (
                  <div key={s.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "14px 18px", borderRadius: "10px",
                    background: "var(--surface)", border: "1px solid var(--border)",
                    gap: "12px", flexWrap: "wrap",
                  }}>
                    <div>
                      <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--charcoal)", marginBottom: "3px" }}>
                        {s.total_count} photo{s.total_count !== 1 ? "s" : ""} · {statusLabel(s.status)}
                      </p>
                      <p style={{ fontSize: "12px", color: "var(--muted)" }}>
                        {new Date(s.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        {s.failed_count > 0 && ` · ${s.failed_count} failed`}
                      </p>
                    </div>
                    {s.awaiting_verification_count > 0 ? (
                      <Link
                        href={`/batch-review/${s.id}`}
                        style={{
                          fontSize: "13px", fontWeight: 500, color: "var(--gold)",
                          textDecoration: "none", padding: "6px 14px",
                          border: "1px solid var(--gold)", borderRadius: "6px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Review {s.awaiting_verification_count}
                      </Link>
                    ) : TERMINAL_SESSION_STATUSES.has(s.status) ? (
                      <Link
                        href={`/batch-review/${s.id}`}
                        style={{ fontSize: "13px", color: "var(--muted)", textDecoration: "none" }}
                      >
                        View session →
                      </Link>
                    ) : (
                      <button
                        onClick={() => {
                          getBatchUploadSession(s.id).then(setSession).catch(() => { /* noop */ });
                          startPolling(s.id);
                        }}
                        style={{ fontSize: "13px", color: "var(--gold)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                      >
                        Resume →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
