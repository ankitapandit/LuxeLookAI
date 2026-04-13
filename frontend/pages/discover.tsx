/**
 * pages/discover.tsx — Discover / The Edit
 *
 * A Pexels-backed fashion swipe feed that learns from like/love/dislike
 * interactions and keeps a per-user ignore list so results do not repeat.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import {
  DiscoverCard,
  DiscoverFeedResponse,
  DiscoverInteractionRequest,
  DiscoverPreferenceRow,
  getProfile,
  getDiscoverJobStatus,
  getDiscoverFeed,
  getDiscoverStatus,
  recordDiscoverInteraction,
  recomputeDiscoverPreferences,
  UserProfile,
} from "@/services/api";
import { Heart, RefreshCw, Sparkles, ThumbsDown, ThumbsUp, User } from "lucide-react";
import toast from "react-hot-toast";

const DISCOVER_STATUS_POLL_MS = 60000;
const DISCOVER_WARMUP_POLL_MS = 30000;
const DISCOVER_REFRESH_POLL_MS = 30000;

function titleCase(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shouldBypassImageOptimization(src: string): boolean {
  return src.startsWith("blob:") || src.startsWith("data:");
}

function getCardImage(card: DiscoverCard): string {
  return card.display_image_url || card.thumbnail_url || card.image_url;
}

function getClientDayKey(): string {
  const timezone = typeof window !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

function getProfileGap(profile: UserProfile | null): string[] {
  if (!profile) return ["profile details"];
  const gaps: string[] = [];
  if (!profile.complexion) gaps.push("complexion");
  return gaps;
}

function PreferenceRail({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: DiscoverPreferenceRow[];
  emptyLabel: string;
}) {
  return (
    <div
      style={{
        borderRadius: "26px",
        border: "1px solid var(--border)",
        background: "linear-gradient(180deg, rgba(23,19,15,0.92), rgba(20,16,13,0.96))",
        padding: "18px",
      }}
    >
      <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "var(--muted)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
        {title}
      </p>

      {rows.length > 0 ? (
        <div style={{ display: "grid", gap: "10px", marginTop: "14px" }}>
          {rows.slice(0, 4).map((row) => (
            <div
              key={row.style_id}
              style={{
                padding: "12px 14px",
                borderRadius: "18px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <div>
                <p style={{ margin: 0, color: "#FFF7ED", fontSize: "14px", fontWeight: 600 }}>{row.label}</p>
                <p style={{ margin: "4px 0 0", color: "rgba(255,247,237,0.68)", fontSize: "12px" }}>
                  {titleCase(row.dimension)} · {titleCase(row.status)}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ margin: 0, color: "var(--gold)", fontSize: "13px", fontWeight: 700 }}>
                  {Math.round((row.score + 1) * 50)}%
                </p>
                <p style={{ margin: "4px 0 0", color: "rgba(255,247,237,0.68)", fontSize: "12px" }}>
                  {row.exposure_count} sees
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: "12px 0 0", color: "rgba(255,247,237,0.72)", lineHeight: 1.6 }}>
          {emptyLabel}
        </p>
      )}
    </div>
  );
}

function StackPreview({
  cards,
  activeAction,
  actionsDisabled,
  disabledMessage,
  onAction,
}: {
  cards: DiscoverCard[];
  activeAction: "love" | "like" | "dislike" | null;
  actionsDisabled: boolean;
  disabledMessage?: string | null;
  onAction: (action: "love" | "like" | "dislike") => void;
}) {
  const previews = cards.slice(0, 3);
  const topCard = previews[0];
  const second = previews[1];
  const third = previews[2];
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const buttonDisabled = !!activeAction || actionsDisabled;
  const disabledButtonStyle = buttonDisabled
    ? {
        color: "rgba(242,216,178,0.42)",
        borderColor: "rgba(212,169,106,0.08)",
        background: "rgba(255,255,255,0.03)",
        cursor: "not-allowed" as const,
      }
    : {};
  const actionPreview =
    dragOffset.x > 140 ? "love" : dragOffset.x > 60 ? "like" : dragOffset.x < -60 ? "dislike" : null;
  const dragTransform =
    dragOffset.x || dragOffset.y
      ? `translateX(${dragOffset.x}px) translateY(${dragOffset.y}px) rotate(${dragOffset.x / 18}deg)`
      : "none";
  const dragOpacity =
    dragOffset.x || dragOffset.y ? Math.max(0.84, 1 - Math.min(Math.abs(dragOffset.x), 180) / 420) : 1;

  function resetDrag() {
    touchStart.current = null;
    setDragOffset({ x: 0, y: 0 });
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (buttonDisabled || event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
    setDragOffset({ x: 0, y: 0 });
  }

  function handleTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    if (!touchStart.current || buttonDisabled || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const deltaX = touch.clientX - touchStart.current.x;
    const deltaY = touch.clientY - touchStart.current.y;
    setDragOffset({ x: deltaX, y: deltaY * 0.18 });
  }

  function handleTouchEnd() {
    if (!touchStart.current || buttonDisabled) {
      resetDrag();
      return;
    }
    const deltaX = dragOffset.x;
    const deltaY = Math.abs(dragOffset.y);
    let action: "love" | "like" | "dislike" | null = null;
    if (Math.abs(deltaX) > deltaY * 1.6) {
      if (deltaX > 140) action = "love";
      else if (deltaX > 80) action = "like";
      else if (deltaX < -80) action = "dislike";
    }
    resetDrag();
    if (action) onAction(action);
  }

  return (
    <div style={{ position: "relative" }}>
      {third ? (
        <div
          style={{
            position: "absolute",
            inset: "28px 22px 0",
            borderRadius: "32px",
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.03)",
            transform: "translateY(24px) scale(0.94) rotate(-3deg)",
            opacity: 0.42,
            filter: "blur(0.2px)",
          }}
        />
      ) : null}
      {second ? (
        <div
          style={{
            position: "absolute",
            inset: "18px 16px 0",
            borderRadius: "32px",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            transform: "translateY(12px) scale(0.97) rotate(2deg)",
            opacity: 0.7,
          }}
        />
      ) : null}

      {topCard ? (
        <div
          style={{
            position: "relative",
            zIndex: 3,
            borderRadius: "34px",
            overflow: "hidden",
            border: "1px solid rgba(212,169,106,0.22)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.24)",
            background: "linear-gradient(180deg, rgba(33,27,22,0.96), rgba(17,13,11,0.98))",
            transform:
              activeAction === "love"
                ? "translateY(-36px) scale(0.97)"
                : activeAction === "like"
                  ? "translateX(26px) rotate(4deg) scale(0.97)"
                  : activeAction === "dislike"
                    ? "translateX(-26px) rotate(-4deg) scale(0.97)"
                    : dragTransform,
            transition: "transform 180ms ease, opacity 180ms ease",
            opacity: activeAction ? 0.92 : dragOpacity,
            touchAction: "pan-y",
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={resetDrag}
        >
          <div style={{ position: "relative", height: "clamp(280px, 42svh, 420px)", background: "#1B1510" }}>
            <Image
              src={getCardImage(topCard)}
              alt={topCard.title}
              fill
              unoptimized={shouldBypassImageOptimization(getCardImage(topCard))}
              sizes="(max-width: 1100px) 92vw, 600px"
              style={{ objectFit: "contain" }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(180deg, rgba(13,10,8,0.06) 0%, rgba(13,10,8,0.16) 44%, rgba(13,10,8,0.82) 100%)",
              }}
            />
            {actionPreview ? (
              <div
                style={{
                  position: "absolute",
                  left: "18px",
                  top: "64px",
                  padding: "10px 14px",
                  borderRadius: "999px",
                  border: "1px solid rgba(255,255,255,0.12)",
                  background:
                    actionPreview === "dislike"
                      ? "rgba(134, 58, 47, 0.68)"
                      : actionPreview === "love"
                        ? "rgba(122, 86, 34, 0.72)"
                        : "rgba(84, 98, 62, 0.7)",
                  color: "#FFF7ED",
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                {actionPreview === "dislike" ? "Pass" : actionPreview === "love" ? "Love" : "Like"}
              </div>
            ) : null}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: "18px", textAlign: "center" }}>
              <p className="type-kicker" style={{ margin: 0, fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,247,237,0.70)" }}>
                The Edit
              </p>
            </div>
          </div>

          <div style={{ padding: "18px", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
              {topCard.style_tags.slice(0, 6).map((tag) => (
                <span
                  key={tag}
                  className="type-chip"
                  style={{
                    background: "rgba(212,169,106,0.08)",
                    border: "1px solid rgba(212,169,106,0.14)",
                    color: "#FFF7ED",
                  }}
                >
                  {titleCase(tag)}
                </span>
              ))}
            </div>

            <div style={{ marginTop: "18px", display: "grid", gap: "10px", width: "100%" }}>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  className="btn-secondary"
                  style={{ flex: "1 1 0", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "#F2D8B2", borderColor: "rgba(212,169,106,0.16)", ...disabledButtonStyle }}
                  aria-label="Dislike this look"
                  onClick={() => onAction("dislike")}
                  disabled={buttonDisabled}
                >
                  <ThumbsDown size={16} />
                  Dislike
                </button>
                <button
                  className="btn-secondary"
                  style={{ flex: "1 1 0", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "#F2D8B2", borderColor: "rgba(212,169,106,0.16)", ...disabledButtonStyle }}
                  aria-label="Like this look"
                  onClick={() => onAction("like")}
                  disabled={buttonDisabled}
                >
                  <ThumbsUp size={16} />
                  Like
                </button>
                <button
                  className="btn-secondary"
                  style={{ flex: "1 1 0", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "#F2D8B2", borderColor: "rgba(212,169,106,0.16)", ...disabledButtonStyle }}
                  aria-label="Love this look"
                  onClick={() => onAction("love")}
                  disabled={buttonDisabled}
                >
                  <Heart size={16} />
                  Love
                </button>
              </div>

              <p style={{ margin: 0, color: actionsDisabled ? "#F2D8B2" : "rgba(255,247,237,0.66)", fontSize: "12px", lineHeight: 1.6, textAlign: "center" }}>
                {actionsDisabled
                  ? disabledMessage || "You have reached your daily quota, please come back tomorrow for more inspiring ideas."
                  : "Every 10 interactions, the feed sharpens your style profile. The ignore list updates immediately so the same links do not circle back."}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            borderRadius: "34px",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg, rgba(33,27,22,0.92), rgba(17,13,11,0.98))",
            minHeight: "clamp(440px, 60svh, 680px)",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            padding: "40px",
          }}
        >
          <div>
            <div
              style={{
                width: "86px",
                height: "86px",
                borderRadius: "28px",
                margin: "0 auto 18px",
                background: "rgba(255,255,255,0.06)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Sparkles size={32} color="var(--gold)" />
            </div>
            <h2 style={{ margin: 0, fontFamily: "Playfair Display, serif", fontSize: "32px", color: "#FFF7ED" }}>
              Searching for the first edit
            </h2>
            <p style={{ margin: "12px auto 0", maxWidth: "28rem", color: "rgba(255,247,237,0.72)", lineHeight: 1.65 }}>
              We seed the search from your profile and pull only single-person fashion inspiration.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DiscoverPage() {
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLocked, setProfileLocked] = useState(false);
  const [profileGap, setProfileGap] = useState<string[]>([]);
  const [feed, setFeed] = useState<DiscoverCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeAction, setActiveAction] = useState<"love" | "like" | "dislike" | null>(null);
  const [interactionCount, setInteractionCount] = useState(0);
  const [dailyInteractions, setDailyInteractions] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(10);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [preferences, setPreferences] = useState<DiscoverPreferenceRow[]>([]);
  const [warmingUp, setWarmingUp] = useState(false);
  const [warmingJobId, setWarmingJobId] = useState<string | null>(null);
  const [refreshJobId, setRefreshJobId] = useState<string | null>(null);
  const [refreshingPreferences, setRefreshingPreferences] = useState(false);
  const seenUrls = useRef<Set<string>>(new Set());
  const warmPollAttempts = useRef(0);
  const refreshPollAttempts = useRef(0);
  const dailyCountDayKeyRef = useRef<string>(getClientDayKey());
  const dailyCountMaxRef = useRef<number>(0);

  const currentCard = feed[0] || null;
  const profileUnlocked = !profileLocked && !profileLoading;
  const nextMilestone = interactionCount <= 0 ? 10 : Math.ceil(interactionCount / 10) * 10;
  const milestoneStepCount = 10;
  const completedSteps = interactionCount > 0 && interactionCount % 10 === 0 ? 10 : interactionCount % 10;
  const dailyQuotaReached = dailyInteractions >= dailyLimit;
  const dailyQuotaMessage = "You have reached your daily quota, please come back tomorrow for more inspiring ideas.";

  const syncDailyInteractions = useCallback((nextCount: number): void => {
    const todayKey = getClientDayKey();
    if (dailyCountDayKeyRef.current !== todayKey) {
      dailyCountDayKeyRef.current = todayKey;
      dailyCountMaxRef.current = 0;
    }
    const safeCount = Math.max(0, Math.floor(nextCount || 0));
    dailyCountMaxRef.current = Math.max(dailyCountMaxRef.current, safeCount);
    setDailyInteractions(dailyCountMaxRef.current);
  }, []);

  const syncFeedMeta = useCallback((response: DiscoverFeedResponse) => {
    setIgnoredCount(response.ignored_url_count);
    setInteractionCount(response.total_interactions || 0);
    syncDailyInteractions(response.daily_interactions ?? 0);
    setDailyLimit(response.daily_limit || 10);
    // Only overwrite preferences when the server actually has data — avoids
    // wiping locally-committed preference updates with a stale empty array.
    if (response.preference_rows && response.preference_rows.length > 0) {
      setPreferences(response.preference_rows);
    }
    setWarmingUp(Boolean(response.warming_up));
    setWarmingJobId(response.queued_job_id || null);
  }, [syncDailyInteractions]);

  useEffect(() => {
    let active = true;

    async function loadProfileThenFeed() {
      setProfileLoading(true);
      setLoading(true);
      try {
        const currentProfile = await getProfile();
        if (!active) return;
        const gaps = getProfileGap(currentProfile);
        setProfileGap(gaps);
        const locked = gaps.length > 0;
        setProfileLocked(locked);
        if (locked) {
          setFeed([]);
          return;
        }

        setProfileLocked(false);
        const response = await getDiscoverFeed(6);
        if (!active) return;
        const status = await getDiscoverStatus();
        if (!active) return;
        syncFeedMeta(response);
        setInteractionCount(status.total_interactions || response.total_interactions || 0);
        syncDailyInteractions(status.daily_interactions ?? response.daily_interactions ?? 0);
        setDailyLimit(status.daily_limit || response.daily_limit || 10);

        const incoming = response.cards.filter((card) => {
          if (seenUrls.current.has(card.normalized_url)) return false;
          seenUrls.current.add(card.normalized_url);
          return true;
        });

        setFeed(incoming);
      } catch {
        if (active) toast.error("Could not load Discover");
      } finally {
        if (active) {
          setLoading(false);
          setLoadingMore(false);
          setProfileLoading(false);
        }
      }
    }

    void loadProfileThenFeed();
    return () => {
      active = false;
    };
  }, [syncDailyInteractions, syncFeedMeta]);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const status = await getDiscoverStatus();
        if (!active) return;
        setInteractionCount(status.total_interactions || 0);
        syncDailyInteractions(status.daily_interactions ?? 0);
        setDailyLimit(status.daily_limit || 10);
        if (status.preference_rows && status.preference_rows.length > 0) {
          setPreferences(status.preference_rows);
        }
      } catch {
        // Keep status quiet if the endpoint is temporarily unavailable.
      }
    }

    void loadStatus();
    const intervalId = window.setInterval(() => {
      if (!warmingUp && !refreshingPreferences && feed.length > 0) return;
      void loadStatus();
    }, DISCOVER_STATUS_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [feed.length, profileUnlocked, refreshingPreferences, syncDailyInteractions, warmingUp]);

  useEffect(() => {
    if (!profileUnlocked) return;
    if (loading || !warmingUp || !warmingJobId) {
      warmPollAttempts.current = 0;
      return;
    }
    if (warmPollAttempts.current >= 8) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      warmPollAttempts.current += 1;
      try {
        const job = await getDiscoverJobStatus(warmingJobId);
        if (job.status === "succeeded") {
          const response = await getDiscoverFeed(6);
          const status = await getDiscoverStatus();
          syncFeedMeta(response);
          setInteractionCount(status.total_interactions || response.total_interactions || 0);
          syncDailyInteractions(status.daily_interactions ?? response.daily_interactions ?? 0);
          setDailyLimit(status.daily_limit || response.daily_limit || 10);

          const incoming = response.cards.filter((card) => {
            if (seenUrls.current.has(card.normalized_url)) return false;
            seenUrls.current.add(card.normalized_url);
            return true;
          });

          if (incoming.length > 0) {
            setFeed((prev) => (prev.length === 0 ? incoming : [...prev, ...incoming]));
            toast.success("Fresh edits are ready");
          }
          if (!response.warming_up || !response.queued_job_id) {
            setWarmingUp(false);
            setWarmingJobId(null);
            warmPollAttempts.current = 0;
          }
        } else if (job.status === "failed") {
          setWarmingUp(false);
          setWarmingJobId(null);
          const status = await getDiscoverStatus();
          syncDailyInteractions(status.daily_interactions ?? 0);
          setDailyLimit(status.daily_limit || 10);
          setPreferences(status.preference_rows || []);
          toast.error("Could not prepare fresh edits");
        }
      } catch {
        // Keep the warm-up state quiet; the manual refresh path remains available.
      }
    }, DISCOVER_WARMUP_POLL_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [feed.length, loading, profileUnlocked, syncDailyInteractions, syncFeedMeta, warmingJobId, warmingUp]);

  useEffect(() => {
    if (!profileUnlocked) return;
    if (!refreshJobId) {
      refreshPollAttempts.current = 0;
      setRefreshingPreferences(false);
      return;
    }
    if (refreshPollAttempts.current >= 10) {
      setRefreshingPreferences(false);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      refreshPollAttempts.current += 1;
      try {
        const job = await getDiscoverJobStatus(refreshJobId);
        if (job.status === "succeeded") {
          const status = await getDiscoverStatus();
          setInteractionCount(status.total_interactions || 0);
          syncDailyInteractions(status.daily_interactions ?? 0);
          setDailyLimit(status.daily_limit || 10);
          setPreferences(status.preference_rows || []);
          setRefreshJobId(null);
          setRefreshingPreferences(false);
          refreshPollAttempts.current = 0;
          toast.success("Taste profile updated from your latest swipes");
        } else if (job.status === "failed") {
          const status = await getDiscoverStatus();
          syncDailyInteractions(status.daily_interactions ?? 0);
          setDailyLimit(status.daily_limit || 10);
          setPreferences(status.preference_rows || []);
          setRefreshJobId(null);
          setRefreshingPreferences(false);
          toast.error("Taste refresh hit a snag");
        } else {
          setRefreshingPreferences(true);
        }
      } catch {
        // Keep background refresh quiet; manual refresh remains available.
      }
    }, DISCOVER_REFRESH_POLL_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [profileUnlocked, refreshJobId, syncDailyInteractions]);

  async function topUpFeed() {
    if (loadingMore || !profileUnlocked) return;
    setLoadingMore(true);
    try {
      const response = await getDiscoverFeed(4);
      const status = await getDiscoverStatus();
      syncFeedMeta(response);
      setInteractionCount(status.total_interactions || response.total_interactions || 0);
      syncDailyInteractions(status.daily_interactions ?? response.daily_interactions ?? 0);
      setDailyLimit(status.daily_limit || response.daily_limit || 10);
      const incoming = response.cards.filter((card) => {
        if (seenUrls.current.has(card.normalized_url)) return false;
        seenUrls.current.add(card.normalized_url);
        return true;
      });
      if (incoming.length > 0) {
        setFeed((prev) => [...prev, ...incoming]);
      }
    } catch {
      toast.error("Could not load more edits");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleAction(action: "love" | "like" | "dislike") {
    if (!currentCard || activeAction || dailyQuotaReached || !profileUnlocked) return;
    const shouldTopUp = feed.length <= 4;
    const nextInteractionCount = interactionCount + 1;
    setActiveAction(action);

    const payload: DiscoverInteractionRequest = {
      action,
      card_id: currentCard.id,
      source_url: currentCard.source_url,
      normalized_url: currentCard.normalized_url,
      image_url: currentCard.image_url,
      thumbnail_url: currentCard.thumbnail_url,
      source_domain: currentCard.source_domain,
      title: currentCard.title,
      summary: currentCard.summary,
      search_query: currentCard.search_query,
      style_tags: currentCard.style_tags,
      style_ids: currentCard.style_ids,
      person_count: currentCard.person_count,
      is_single_person: currentCard.is_single_person,
      analysis: currentCard.analysis || undefined,
      interaction_index: nextInteractionCount,
      commit_preferences: nextInteractionCount % 10 === 0,
    };

    try {
      const response = await recordDiscoverInteraction(payload);
      const quotaReachedAfterAction = (response.daily_interactions || 0) >= (response.daily_limit || 10);
      if (response.commit_triggered && response.queued_job_id) {
        setRefreshJobId(response.queued_job_id);
        setRefreshingPreferences(true);
        refreshPollAttempts.current = 0;
      }
      setTimeout(() => {
        setFeed((prev) => prev.slice(1));
        setInteractionCount(response.total_interactions || nextInteractionCount);
        syncDailyInteractions(response.daily_interactions ?? dailyInteractions + 1);
        setDailyLimit(response.daily_limit || 10);
        setActiveAction(null);
        if (response.commit_triggered && response.updated_preferences.length > 0) {
          setPreferences(response.updated_preferences);
          toast.success("Taste profile updated");
        } else if (nextInteractionCount % 10 === 0) {
          toast.success("Ten actions logged. Discover is learning faster now.");
        }
        if (shouldTopUp && !quotaReachedAfterAction) {
          void topUpFeed();
        }
      }, 160);
    } catch (error: unknown) {
      setActiveAction(null);
      const detail =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail === "string"
          ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : "";
      toast.error(typeof detail === "string" && detail.trim() ? detail : "Could not save that choice");
    }
  }

  async function handleRefreshPreferences() {
    if (!profileUnlocked) return;
    try {
      const response = await recomputeDiscoverPreferences();
      setInteractionCount(response.total_interactions || 0);
      syncDailyInteractions(response.daily_interactions ?? 0);
      setDailyLimit(response.daily_limit || 10);
      if (response.updated_preferences.length > 0) {
        setPreferences(response.updated_preferences);
        toast.success("Taste profile refreshed");
      } else {
        toast(response.message || "Need a few more interactions before preferences settle.");
      }
    } catch {
      toast.error("Could not refresh preferences");
    }
  }

  const visiblePreferenceRows = preferences.filter(
    (row) => !["garment_type", "season", "occasion"].includes(String(row.dimension || "")),
  );
  const preferredRows = (() => {
    const preferred = visiblePreferenceRows
      .filter((row) => row.status === "preferred")
      .sort((a, b) => b.score - a.score);
    if (preferred.length > 0) return preferred;
    return visiblePreferenceRows
      .filter((row) => (row.score || 0) > 0)
      .sort((a, b) => {
        const scoreDelta = (b.score || 0) - (a.score || 0);
        if (scoreDelta !== 0) return scoreDelta;
        return (b.confidence || 0) - (a.confidence || 0);
      })
      .slice(0, 6);
  })();
  const dislikedRows = (() => {
    const disliked = visiblePreferenceRows
      .filter((row) => row.status === "disliked")
      .sort((a, b) => a.score - b.score);
    if (disliked.length > 0) return disliked;
    return visiblePreferenceRows
      .filter((row) => (row.score || 0) < 0)
      .sort((a, b) => {
        const scoreDelta = (a.score || 0) - (b.score || 0);
        if (scoreDelta !== 0) return scoreDelta;
        return (b.confidence || 0) - (a.confidence || 0);
      })
      .slice(0, 6);
  })();

  return (
    <>
      <Head>
        <title>Discover — LuxeLook AI</title>
      </Head>
      <Navbar />
      <style jsx>{`
        .discover-top-stack {
          display: grid;
          gap: 18px;
        }

        .discover-stage-header {
          display: grid;
          gap: 10px;
          padding: 6px 6px 18px;
        }

        .discover-stage-title {
          margin: 0;
          font-family: "Playfair Display", serif;
          font-size: clamp(40px, 5vw, 66px);
          line-height: 0.94;
          letter-spacing: -0.05em;
          color: #fff7ed;
        }

        .discover-stage-copy {
          margin: 0;
          max-width: 38rem;
          font-size: 15px;
          line-height: 1.72;
          color: rgba(255, 247, 237, 0.76);
        }

        .discover-stage-shell {
          border-radius: 32px;
          padding: 18px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          min-height: 0;
        }

        .discover-utility-shell {
          border-radius: 32px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: linear-gradient(160deg, rgba(28, 22, 17, 0.96) 0%, rgba(19, 15, 12, 0.98) 100%);
          padding: 24px 28px;
          color: #fff7ed;
          display: grid;
          gap: 22px;
        }

        .discover-utility-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .discover-rails-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 18px;
        }

        @media (max-width: 1080px) {
          .discover-rails-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 720px) {
          .discover-top-stack {
            gap: 16px;
          }

          .discover-utility-shell {
            padding: 20px;
          }

          .discover-stage-header {
            padding: 2px 2px 14px;
          }

          .discover-stage-title {
            font-size: clamp(34px, 10vw, 54px);
          }

          .discover-stage-copy {
            font-size: 14px;
            line-height: 1.62;
          }
        }
      `}</style>

      {profileLoading ? (
        <main
          className="page-main"
          style={{
            minHeight: "calc(100vh - 64px)",
            display: "grid",
            placeItems: "center",
            padding: "28px 24px 72px",
            background:
              "radial-gradient(circle at top right, rgba(212,169,106,0.16), transparent 28%), radial-gradient(circle at bottom left, rgba(136,98,65,0.18), transparent 26%), linear-gradient(180deg, #120E0B 0%, #17120E 36%, #15110D 100%)",
          }}
        >
          <div style={{ textAlign: "center", color: "#FFF7ED" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                margin: "0 auto 16px",
                border: "3px solid rgba(255,255,255,0.14)",
                borderTop: "3px solid var(--gold)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <p style={{ margin: 0, fontSize: "15px", color: "rgba(255,247,237,0.72)" }}>
              Checking your profile…
            </p>
          </div>
        </main>
      ) : profileLocked ? (
        <main
          className="page-main"
          style={{
            minHeight: "calc(100vh - 64px)",
            display: "grid",
            placeItems: "center",
            padding: "28px 24px 72px",
            background:
              "radial-gradient(circle at top right, rgba(212,169,106,0.16), transparent 28%), radial-gradient(circle at bottom left, rgba(136,98,65,0.18), transparent 26%), linear-gradient(180deg, #120E0B 0%, #17120E 36%, #15110D 100%)",
          }}
        >
          <div
            style={{
              width: "min(720px, 100%)",
              borderRadius: "30px",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "linear-gradient(180deg, rgba(33,27,22,0.98), rgba(18,14,11,0.98))",
              padding: "28px",
              color: "#FFF7ED",
              boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
              <div style={{
                width: "44px",
                height: "44px",
                borderRadius: "14px",
                background: "rgba(255,255,255,0.06)",
                display: "grid",
                placeItems: "center",
              }}>
                <User size={20} color="var(--gold)" />
              </div>
              <div>
                <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "rgba(255,247,237,0.66)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                  Update profile first
                </p>
                <h1 style={{ margin: "6px 0 0", fontFamily: "Playfair Display, serif", fontSize: "clamp(30px, 4vw, 48px)", lineHeight: 0.98 }}>
                  Unlock Discover with your style profile
                </h1>
              </div>
            </div>
            <p style={{ margin: 0, color: "rgba(255,247,237,0.74)", lineHeight: 1.7, fontSize: "15px" }}>
              Discover needs a few profile details before it can seed your edit well. Please update your profile and add:
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "14px" }}>
              {profileGap.map((field) => (
                <span
                  key={field}
                  className="type-chip"
                  style={{
                    background: "rgba(212,169,106,0.08)",
                    color: "#FFF7ED",
                    border: "1px solid rgba(212,169,106,0.16)",
                  }}
                >
                  {field}
                </span>
              ))}
            </div>
            <div style={{ marginTop: "20px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <Link href="/profile" style={{ textDecoration: "none" }}>
                <span className="btn-primary" style={{ display: "inline-flex", alignItems: "center" }}>
                  Update profile
                </span>
              </Link>
              <span style={{ alignSelf: "center", color: "rgba(255,247,237,0.62)", fontSize: "13px" }}>
                Complexion helps shape a better first edit, while gender and ethnicity can refine it further.
              </span>
            </div>
          </div>
        </main>
      ) : (
      <main
        className="page-main"
        style={{
          minHeight: "calc(100vh - 64px)",
          padding: "28px 24px 72px",
          background:
            "radial-gradient(circle at top right, rgba(212,169,106,0.16), transparent 28%), radial-gradient(circle at bottom left, rgba(136,98,65,0.18), transparent 26%), linear-gradient(180deg, #120E0B 0%, #17120E 36%, #15110D 100%)",
        }}
      >
        <div style={{ maxWidth: "1320px", margin: "0 auto", display: "grid", gap: "22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 4px" }}>
            <Sparkles size={18} color="var(--gold)" />
            <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,247,237,0.68)" }}>
              Discover
            </span>
          </div>

          <section className="discover-top-stack">
            <div className="discover-utility-shell">
              <div style={{ display: "grid", gap: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "rgba(255,247,237,0.64)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                    Learning pace
                  </p>
                  <span
                    style={{
                      color: "#FFF7ED",
                      fontSize: "12px",
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      padding: "6px 10px",
                      borderRadius: "999px",
                      border: "1px solid rgba(212,169,106,0.18)",
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    {interactionCount}/{nextMilestone}
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${milestoneStepCount}, minmax(0, 1fr))`,
                    gap: "8px",
                  }}
                >
                  {Array.from({ length: milestoneStepCount }, (_, index) => {
                    const filled = index < completedSteps;
                    return (
                      <div
                        key={index}
                        style={{
                          height: "10px",
                          borderRadius: "999px",
                          background: filled
                            ? "linear-gradient(90deg, rgba(212,169,106,0.82), rgba(255,219,169,0.98))"
                            : "rgba(255,255,255,0.07)",
                          border: filled ? "1px solid rgba(255,219,169,0.24)" : "1px solid rgba(255,255,255,0.05)",
                          transition: "background 0.18s ease, border-color 0.18s ease",
                        }}
                      />
                    );
                  })}
                </div>

              </div>
            </div>

            <div className="discover-stage-shell">
              <div className="discover-stage-header">
                <h1 className="discover-stage-title">The Edit</h1>
                <p className="discover-stage-copy">
                  We learn your likes and dislikes, one edit at a time, so each next look feels more like you.
                </p>
              </div>
              {loading ? (
                <div
                  style={{
                    minHeight: "clamp(420px, 58svh, 680px)",
                    borderRadius: "28px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "linear-gradient(180deg, rgba(33,27,22,0.96), rgba(18,14,11,0.98))",
                    display: "grid",
                    placeItems: "center",
                    textAlign: "center",
                    padding: "40px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        width: "84px",
                        height: "84px",
                        borderRadius: "28px",
                        margin: "0 auto 18px",
                        background: "rgba(255,255,255,0.06)",
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <Sparkles size={30} color="var(--gold)" />
                    </div>
                    <h2 style={{ margin: 0, fontFamily: "Playfair Display, serif", fontSize: "32px", color: "#FFF7ED" }}>
                      Searching the edit
                    </h2>
                    <p style={{ margin: "10px auto 0", maxWidth: "26rem", color: "rgba(255,247,237,0.72)", lineHeight: 1.65 }}>
                      Pulling fashion inspiration and keeping only the single-person results.
                    </p>
                  </div>
                </div>
              ) : dailyQuotaReached ? (
                <div
                  style={{
                    minHeight: "clamp(420px, 58svh, 680px)",
                    borderRadius: "28px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "linear-gradient(180deg, rgba(33,27,22,0.96), rgba(18,14,11,0.98))",
                    display: "grid",
                    placeItems: "center",
                    textAlign: "center",
                    padding: "40px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        width: "84px",
                        height: "84px",
                        borderRadius: "28px",
                        margin: "0 auto 18px",
                        background: "rgba(255,255,255,0.06)",
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <Sparkles size={30} color="var(--gold)" />
                    </div>
                    <h2 style={{ margin: 0, fontFamily: "Playfair Display, serif", fontSize: "32px", color: "#FFF7ED" }}>
                      Daily quota reached
                    </h2>
                    <p style={{ margin: "10px auto 0", maxWidth: "28rem", color: "rgba(255,247,237,0.72)", lineHeight: 1.65 }}>
                      {dailyQuotaMessage}
                    </p>
                  </div>
                </div>
              ) : currentCard ? (
                <StackPreview
                  cards={feed}
                  activeAction={activeAction}
                  actionsDisabled={dailyQuotaReached}
                  disabledMessage={dailyQuotaMessage}
                  onAction={(action) => void handleAction(action)}
                />
              ) : (
                <div
                  style={{
                    minHeight: "clamp(420px, 58svh, 680px)",
                    borderRadius: "28px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "linear-gradient(180deg, rgba(33,27,22,0.96), rgba(18,14,11,0.98))",
                    display: "grid",
                    placeItems: "center",
                    textAlign: "center",
                    padding: "40px",
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0, fontFamily: "Playfair Display, serif", fontSize: "30px", color: "#FFF7ED" }}>
                      {warmingUp ? "Warming up the edit" : "No cards right now"}
                    </h2>
                    <p style={{ margin: "10px auto 0", maxWidth: "28rem", color: "rgba(255,247,237,0.72)", lineHeight: 1.65 }}>
                      {warmingUp
                        ? "A background worker is pulling and analyzing fresh candidates for your Discover feed. Give it a moment, then refresh."
                        : ignoredCount > 0
                          ? `We have already set aside ${ignoredCount} looks you acted on. Give the feed a moment to pull fresh ideas.`
                          : "The feed is between edits right now. Tap refresh or come back after a few more style changes."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section
            className="discover-rails-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: "18px",
            }}
          >
            <PreferenceRail
              title="Likes"
              rows={preferredRows}
              emptyLabel="Styles you like will appear here as you swipe."
            />
            <PreferenceRail
              title="Dislikes"
              rows={dislikedRows}
              emptyLabel="Styles you dislike will appear here as you swipe."
            />
          </section>

          <section
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
              padding: "16px 4px 0",
              color: "rgba(255,247,237,0.68)",
              fontSize: "13px",
            }}
          >
            <p style={{ margin: 0 }}>
              {ignoredCount > 0
                ? `${ignoredCount} swiped looks are excluded from repeat cards.`
                : "Looks you swipe on will stay out of the repeat pool."}
            </p>
            <p style={{ margin: 0 }}>
              Current card count: {feed.length}
            </p>
          </section>

          <section
            style={{
              display: "flex",
              justifyContent: "flex-start",
              padding: "0 4px",
            }}
          >
            <button
              onClick={() => void handleRefreshPreferences()}
              disabled={loading || loadingMore}
              style={{
                appearance: "none",
                border: "none",
                background: "transparent",
                color: "rgba(255,247,237,0.54)",
                fontSize: "12px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: 0,
                cursor: loading || loadingMore ? "not-allowed" : "pointer",
              }}
            >
              <RefreshCw size={12} />
              Reset
            </button>
          </section>
        </div>
      </main>
      )}
    </>
  );
}
