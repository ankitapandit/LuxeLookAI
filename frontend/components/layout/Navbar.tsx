/**
 * components/layout/Navbar.tsx — Top navigation bar
 * Shows the LuxeLook branding + nav links + auth state.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/hooks/useAuth";
import { Sparkles, ShirtIcon, CalendarDays, LogOut, User, Menu, X } from "lucide-react";

export default function Navbar() {
  const router = useRouter();
  const { isAuthenticated, loading, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [router.pathname]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("menu-open", mobileOpen);
    return () => document.body.classList.remove("menu-open");
  }, [mobileOpen]);

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
          <Sparkles size={20} color="var(--gold)" />
          <span
            style={{
              fontFamily: "Playfair Display, serif",
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--charcoal)",
              letterSpacing: "-0.02em",
            }}
          >
            LuxeLook
            <span style={{ color: "var(--gold)" }}>AI</span>
          </span>
        </div>
      </Link>

      {/* ── Nav links (only shown when authenticated) ─────────────────── */}
      {!loading && isAuthenticated && (
        <>
          <div className="nav-desktop" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <NavLink href="/wardrobe" icon={<ShirtIcon size={16} />} label="Wardrobe" active={router.pathname === "/wardrobe"} />
            <NavLink href="/archive"  icon={<Sparkles size={16} />}   label="Archive"  active={router.pathname === "/archive"} />
            <NavLink href="/event"   icon={<CalendarDays size={16} />} label="Event" active={router.pathname === "/event"} />
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
              <MobileNavLink href="/archive" icon={<Sparkles size={16} />} label="Archive" active={router.pathname === "/archive"} />
              <MobileNavLink href="/event" icon={<CalendarDays size={16} />} label="Event" active={router.pathname === "/event"} />
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
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
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
      }}
      className="type-helper"
    >
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
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link href={href} className={`nav-mobile-link${active ? " active" : ""}`}>
      {icon}
      {label}
    </Link>
  );
}
