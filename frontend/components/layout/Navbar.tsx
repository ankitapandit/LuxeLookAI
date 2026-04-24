/**
 * components/layout/Navbar.tsx — Top navigation bar
 * Shows the LuxeLook branding + nav links + auth state.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/hooks/useAuth";
import { listBatchUploadSessions } from "@/services/api";
import { Sparkles, ShirtIcon, CalendarDays, LogOut, User, Menu, X, WandSparkles, BookOpen, Layers } from "lucide-react";
import logo from "../../assets/logo.png";

export default function Navbar() {
  const router = useRouter();
  const { isAuthenticated, loading, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [batchNeedsReview, setBatchNeedsReview] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [router.pathname]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("menu-open", mobileOpen);
    return () => document.body.classList.remove("menu-open");
  }, [mobileOpen]);

  useEffect(() => {
    if (loading || !isAuthenticated) {
      setBatchNeedsReview(false);
      return;
    }

    let cancelled = false;

    async function refreshBatchIndicator() {
      try {
        const sessions = await listBatchUploadSessions(12);
        if (cancelled) return;
        setBatchNeedsReview(sessions.some((session) => session.awaiting_verification_count > 0));
      } catch {
        if (!cancelled) setBatchNeedsReview(false);
      }
    }

    void refreshBatchIndicator();
    const intervalId = window.setInterval(() => {
      void refreshBatchIndicator();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated, loading, router.asPath]);

  function handleLogout() {
    logout();
    setMobileOpen(false);
    router.push("/");
  }

  return (
    <nav
      style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        padding: "0 24px",
        height: "64px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
      {/* ── Brand ─────────────────────────────────────────────────────── */}
      <Link href={isAuthenticated ? "/wardrobe" : "/"} style={{ textDecoration: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/*<Sparkles size={20} color="var(--gold)" />*/}
          <img src={logo.src} alt="LuxeLook AI" className="h-16 w-16" />
          {/*<span*/}
          {/*  style={{*/}
          {/*    fontFamily: "Playfair Display, serif",*/}
          {/*    fontSize: "20px",*/}
          {/*    fontWeight: 700,*/}
          {/*    color: "var(--charcoal)",*/}
          {/*    letterSpacing: "-0.02em",*/}
          {/*  }}*/}
          {/*>*/}
          {/*  LuxeLook*/}
          {/*  <span style={{ color: "var(--gold)" }}>AI</span>*/}
          {/*</span>*/}
        </div>
      </Link>

      {/* ── Nav links (only shown when authenticated) ─────────────────── */}
      {!loading && isAuthenticated && (
        <>
          <div className="nav-desktop" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <NavLink href="/wardrobe" icon={<ShirtIcon size={16} />} label="Wardrobe" active={router.pathname === "/wardrobe"} />
            <NavLink
              href="/batch-upload"
              icon={<Layers size={16} />}
              label="Batch Upload"
              active={router.pathname.startsWith("/batch")}
              attention={batchNeedsReview}
            />
            <NavLink href="/discover" icon={<Sparkles size={16} />} label="Discover" active={router.pathname === "/discover"} />
            <NavLink href="/style-item" icon={<WandSparkles size={16} />} label="Style Item" active={router.pathname === "/style-item"} />
            <NavLink href="/archive"  icon={<Sparkles size={16} />}   label="Archive"  active={router.pathname === "/archive"} />
            <NavLink href="/event"   icon={<CalendarDays size={16} />} label="Event" active={router.pathname === "/event"} />
            <NavLink href="/guide" icon={<BookOpen size={16} />} label="Guide" active={router.pathname === "/guide"} />
            <NavLink href="/profile"   icon={<User size={16} />} label="Profile" active={router.pathname === "/profile"} />

            <button
              onClick={handleLogout}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                padding: "8px 12px",
                borderRadius: "6px",
                fontSize: "14px",
                marginLeft: "8px",
              }}
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>

          <button
            className="nav-mobile-toggle"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          {mobileOpen && (
            <div className="nav-mobile-menu">
              <MobileNavLink href="/wardrobe" icon={<ShirtIcon size={16} />} label="Wardrobe" active={router.pathname === "/wardrobe"} />
              <MobileNavLink
                href="/batch-upload"
                icon={<Layers size={16} />}
                label="Batch Upload"
                active={router.pathname.startsWith("/batch")}
                attention={batchNeedsReview}
              />
              <MobileNavLink href="/discover" icon={<Sparkles size={16} />} label="Discover" active={router.pathname === "/discover"} />
              <MobileNavLink href="/style-item" icon={<WandSparkles size={16} />} label="Style Item" active={router.pathname === "/style-item"} />
              <MobileNavLink href="/archive" icon={<Sparkles size={16} />} label="Archive" active={router.pathname === "/archive"} />
              <MobileNavLink href="/event" icon={<CalendarDays size={16} />} label="Event" active={router.pathname === "/event"} />
              <MobileNavLink href="/guide" icon={<BookOpen size={16} />} label="Guide" active={router.pathname === "/guide"} />
              <MobileNavLink href="/profile" icon={<User size={16} />} label="Profile" active={router.pathname === "/profile"} />
              <button className="nav-mobile-logout" onClick={handleLogout}>
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </>
      )}
    </nav>
  );
}

function NavLink({
  href,
  icon,
  label,
  active,
  attention = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  attention?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "8px 16px",
        borderRadius: "6px",
        textDecoration: "none",
        fontSize: "14px",
        fontWeight: active ? 500 : 400,
        color: active ? "var(--charcoal)" : "var(--muted)",
        background: active ? "var(--surface)" : "transparent",
        transition: "all 0.15s ease",
        position: "relative",
      }}
      className="type-helper"
    >
      {attention && (
        <span
          aria-hidden="true"
          title="Batch upload items need review"
          style={{
            position: "absolute",
            top: "8px",
            right: "7px",
            width: "6px",
            height: "6px",
            borderRadius: "999px",
            background: "var(--gold)",
            border: "1px solid rgba(120, 84, 18, 0.95)",
            boxShadow: "0 0 0 2px rgba(120, 84, 18, 0.18), 0 0 8px rgba(212, 175, 55, 0.28)",
          }}
        />
      )}
      {icon}
      {label}
    </Link>
  );
}

function MobileNavLink({
  href,
  icon,
  label,
  active,
  attention = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  attention?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`nav-mobile-link${active ? " active" : ""}`}
      style={{ position: "relative" }}
    >
      {attention && (
        <span
          aria-hidden="true"
          title="Batch upload items need review"
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            width: "6px",
            height: "6px",
            borderRadius: "999px",
            background: "var(--gold)",
            border: "1px solid rgba(120, 84, 18, 0.95)",
            boxShadow: "0 0 0 2px rgba(120, 84, 18, 0.18), 0 0 8px rgba(212, 175, 55, 0.28)",
          }}
        />
      )}
      {icon}
      {label}
    </Link>
  );
}
