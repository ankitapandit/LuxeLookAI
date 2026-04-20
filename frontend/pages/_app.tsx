/**
 * pages/_app.tsx — Next.js application root
 * Wraps every page with the toast notification provider and global CSS.
 */

import type { AppProps } from "next/app";
import { useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { endPageVisit, prewarmDiscover, startPageVisit } from "@/services/api";
import "@/styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <>
        <AuthGate>
          <PageVisitTracker />
          <Component {...pageProps} />
        </AuthGate>
        {/* Toast notifications — positioned bottom-right in a LuxeLook style */}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              fontFamily: "DM Sans, sans-serif",
              background: "var(--surface)",
              color: "var(--ink)",
              borderRadius: "8px",
              fontSize: "14px",
            },
            success: { iconTheme: { primary: "#D4A96A", secondary: "var(--surface)" } },
          }}
        />
      </>
    </AuthProvider>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, loading, userId } = useAuth();
  const isPublicRoute = router.pathname === "/";

  useEffect(() => {
    if (loading) return;
    if (!isPublicRoute && !isAuthenticated) {
      router.replace("/");
    }
  }, [loading, isAuthenticated, isPublicRoute, router]);

  useEffect(() => {
    if (loading || !isAuthenticated || !userId) return;
    if (typeof window === "undefined") return;

    const key = `luxelook-discover-prewarm:${userId}`;
    const lastRun = Number(window.localStorage.getItem(key) || "0");
    const now = Date.now();
    const cooldownMs = 1000 * 60 * 20;
    if (lastRun > 0 && now - lastRun < cooldownMs) {
      return;
    }

    window.localStorage.setItem(key, String(now));
    void prewarmDiscover(6).catch(() => {
      window.localStorage.removeItem(key);
      // Discover prewarm is intentionally silent from the global shell.
    });
  }, [loading, isAuthenticated, userId]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--cream)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: "42px",
            height: "42px",
            margin: "0 auto 16px",
            border: "3px solid var(--border)",
            borderTop: "3px solid var(--gold)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          <p className="type-helper" style={{ color: "var(--muted)" }}>Restoring your session…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (!isPublicRoute && !isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}

const PAGE_VISIT_SESSION_KEY = "luxelook-page-visit-session-id";
const ACTIVE_PAGE_VISIT_KEY = "luxelook-active-page-visit";

type ActivePageVisit = {
  visitId: string;
  pageKey: string;
  path: string;
  startedAtMs: number;
};

function getPageKeyFromPath(path: string): string {
  const clean = path.split("?")[0]?.split("#")[0] || "/";
  if (clean === "/") return "home";
  return clean
    .replace(/^\/+/, "")
    .replace(/\/+/g, "_")
    .replace(/-+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase() || "unknown";
}

function getOrCreateVisitSessionId(): string | null {
  if (typeof window === "undefined") return null;
  const existing = window.sessionStorage.getItem(PAGE_VISIT_SESSION_KEY);
  if (existing) return existing;
  const nextId =
    typeof window.crypto !== "undefined" && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `visit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(PAGE_VISIT_SESSION_KEY, nextId);
  return nextId;
}

function loadActivePageVisit(): ActivePageVisit | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_PAGE_VISIT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActivePageVisit>;
    if (!parsed.visitId || !parsed.pageKey || !parsed.path || typeof parsed.startedAtMs !== "number") {
      return null;
    }
    return {
      visitId: parsed.visitId,
      pageKey: parsed.pageKey,
      path: parsed.path,
      startedAtMs: parsed.startedAtMs,
    };
  } catch {
    return null;
  }
}

function saveActivePageVisit(visit: ActivePageVisit | null) {
  if (typeof window === "undefined") return;
  if (!visit) {
    window.sessionStorage.removeItem(ACTIVE_PAGE_VISIT_KEY);
    return;
  }
  window.sessionStorage.setItem(ACTIVE_PAGE_VISIT_KEY, JSON.stringify(visit));
}

function PageVisitTracker() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();
  const activeVisitRef = useRef<ActivePageVisit | null>(null);
  const lastPageKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !isAuthenticated || !router.isReady) return;
    if (typeof window === "undefined") return;

    const sessionId = getOrCreateVisitSessionId();
    if (!sessionId) return;
    const stableSessionId = sessionId;

    let cancelled = false;

    async function beginVisit(path: string, referrerPageKey?: string | null) {
      const pageKey = getPageKeyFromPath(path);
      try {
        const result = await startPageVisit({
          session_id: stableSessionId,
          page_key: pageKey,
          referrer_page_key: referrerPageKey || undefined,
          source: "web",
        });
        if (cancelled) return;
        const nextVisit = {
          visitId: result.visit_id,
          pageKey,
          path,
          startedAtMs: Date.now(),
        };
        activeVisitRef.current = nextVisit;
        saveActivePageVisit(nextVisit);
        lastPageKeyRef.current = pageKey;
      } catch {
        // Best-effort only.
      }
    }

    async function finishVisit() {
      const activeVisit = activeVisitRef.current;
      if (!activeVisit) return;
      activeVisitRef.current = null;
      saveActivePageVisit(null);
      const payload = {
        visit_id: activeVisit.visitId,
        left_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - activeVisit.startedAtMs),
      };
      try {
        await endPageVisit(payload);
      } catch {
        // Best-effort only.
      }
    }

    function handleRouteChangeStart() {
      void finishVisit();
    }

    function handleRouteChangeComplete(url: string) {
      const referrerPageKey = lastPageKeyRef.current;
      void beginVisit(url, referrerPageKey);
    }

    const initialPath = router.asPath || router.pathname;
    const persistedVisit = loadActivePageVisit();
    if (persistedVisit && persistedVisit.path === initialPath) {
      activeVisitRef.current = persistedVisit;
      lastPageKeyRef.current = persistedVisit.pageKey;
    } else if (persistedVisit && persistedVisit.path !== initialPath) {
      activeVisitRef.current = persistedVisit;
      lastPageKeyRef.current = persistedVisit.pageKey;
      void finishVisit().finally(() => {
        void beginVisit(initialPath, persistedVisit.pageKey);
      });
    } else if (!activeVisitRef.current) {
      void beginVisit(initialPath, null);
    }

    router.events.on("routeChangeStart", handleRouteChangeStart);
    router.events.on("routeChangeComplete", handleRouteChangeComplete);

    return () => {
      cancelled = true;
      router.events.off("routeChangeStart", handleRouteChangeStart);
      router.events.off("routeChangeComplete", handleRouteChangeComplete);
    };
  }, [isAuthenticated, loading, router]);

  return null;
}
