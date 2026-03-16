/**
 * pages/index.tsx — Landing / Auth page
 * Shows a login and signup form. Redirects to /wardrobe on success.
 */

import { useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/hooks/useAuth";
import { Sparkles } from "lucide-react";
import Head from "next/head";

export default function Home() {
  const router              = useRouter();
  const { login, signup }   = useAuth();
  const [mode, setMode]     = useState<"login" | "signup">("login");
  const [email, setEmail]   = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const fn      = mode === "login" ? login : signup;
    const success = await fn(email, password);
    setLoading(false);
    if (success) router.push("/wardrobe");
  }

  return (
    <>
      <Head>
        <title>LuxeLook AI — Your Personal AI Stylist</title>
      </Head>

      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        {/* ── Left: hero ─────────────────────────────────────────────── */}
        <div
          style={{
            background: "var(--charcoal)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "80px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "40px" }}>
            <Sparkles size={28} color="var(--gold)" />
            <span
              style={{
                fontFamily: "Playfair Display, serif",
                fontSize: "26px",
                fontWeight: 700,
                color: "var(--cream)",
              }}
            >
              LuxeLook<span style={{ color: "var(--gold)" }}>AI</span>
            </span>
          </div>

          <h1
            style={{
              fontFamily: "Playfair Display, serif",
              fontSize: "52px",
              fontWeight: 700,
              color: "var(--cream)",
              lineHeight: 1.1,
              marginBottom: "24px",
            }}
          >
            Your wardrobe,{" "}
            <em style={{ color: "var(--gold)", fontStyle: "italic" }}>
              reimagined
            </em>
          </h1>

          <p
            style={{
              color: "#A09890",
              fontSize: "17px",
              lineHeight: 1.6,
              maxWidth: "380px",
            }}
          >
            LuxeLook AI is your personal stylist — powered by computer vision
            and AI. Tell us the occasion. We'll build the perfect outfit from
            your own wardrobe.
          </p>

          {/* Feature list */}
          <div style={{ marginTop: "48px", display: "flex", flexDirection: "column", gap: "14px" }}>
            {[
              "📸 Auto-tag every item with AI",
              "✨ CLIP-powered visual similarity",
              "🎯 Hybrid rule + embedding ranking",
              "💬 LLM-generated style explanations",
            ].map((f) => (
              <div
                key={f}
                style={{
                  color: "#C8C0B8",
                  fontSize: "15px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                {f}
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: auth form ────────────────────────────────────────── */}
        <div
          style={{
            background: "var(--cream)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px",
          }}
        >
          <div style={{ width: "100%", maxWidth: "380px" }} className="fade-up">
            <h2
              style={{
                fontFamily: "Playfair Display, serif",
                fontSize: "32px",
                marginBottom: "8px",
                color: "var(--charcoal)",
              }}
            >
              {mode === "login" ? "Welcome back" : "Get started"}
            </h2>
            <p style={{ color: "var(--muted)", marginBottom: "36px", fontSize: "15px" }}>
              {mode === "login"
                ? "Sign in to your LuxeLook account"
                : "Create your AI stylist account"}
            </p>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--ink)", marginBottom: "6px", letterSpacing: "0.03em", textTransform: "uppercase" }}>
                  Email
                </label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--ink)", marginBottom: "6px", letterSpacing: "0.03em", textTransform: "uppercase" }}>
                  Password
                </label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
                style={{ marginTop: "8px", width: "100%" }}
              >
                {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
              </button>
            </form>

            <p style={{ textAlign: "center", marginTop: "24px", color: "var(--muted)", fontSize: "14px" }}>
              {mode === "login" ? "New to LuxeLook? " : "Already have an account? "}
              <button
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--gold)",
                  cursor: "pointer",
                  fontWeight: 500,
                  fontSize: "14px",
                  textDecoration: "underline",
                }}
              >
                {mode === "login" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
