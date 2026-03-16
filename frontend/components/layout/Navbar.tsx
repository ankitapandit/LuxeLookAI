/**
 * components/layout/Navbar.tsx — Top navigation bar
 * Shows the LuxeLook branding + nav links + auth state.
 */

import Link from "next/link";
import { useRouter } from "next/router";
import { logout, isLoggedIn } from "@/services/api";
import { Sparkles, ShirtIcon, CalendarDays, LogOut } from "lucide-react";

export default function Navbar() {
  const router = useRouter();
  const authenticated = typeof window !== "undefined" ? isLoggedIn() : false;

  function handleLogout() {
    logout();
    router.push("/");
  }

  return (
    <nav
      style={{
        background: "white",
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
      <Link href={authenticated ? "/wardrobe" : "/"} style={{ textDecoration: "none" }}>
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
      {authenticated && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <NavLink href="/wardrobe" icon={<ShirtIcon size={16} />} label="Wardrobe" active={router.pathname === "/wardrobe"} />
          <NavLink href="/outfits"  icon={<Sparkles size={16} />}   label="Outfits"  active={router.pathname === "/outfits"} />
          <NavLink href="/events"   icon={<CalendarDays size={16} />} label="Events" active={router.pathname === "/events"} />

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
    >
      {icon}
      {label}
    </Link>
  );
}
