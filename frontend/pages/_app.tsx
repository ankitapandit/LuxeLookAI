/**
 * pages/_app.tsx — Next.js application root
 * Wraps every page with the toast notification provider and global CSS.
 */

import type { AppProps } from "next/app";
import { useEffect } from "react";
import { useRouter } from "next/router";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import "@/styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <>
        <AuthGate>
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
  const { isAuthenticated, loading } = useAuth();
  const isPublicRoute = router.pathname === "/";

  useEffect(() => {
    if (loading) return;
    if (!isPublicRoute && !isAuthenticated) {
      router.replace("/");
    }
  }, [loading, isAuthenticated, isPublicRoute, router]);

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
