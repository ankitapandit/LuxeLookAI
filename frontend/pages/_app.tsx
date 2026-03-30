/**
 * pages/_app.tsx — Next.js application root
 * Wraps every page with the toast notification provider and global CSS.
 */

import type { AppProps } from "next/app";
import { Toaster } from "react-hot-toast";
import "@/styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
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
  );
}
