"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Last-resort boundary for an error thrown by the root layout itself (e.g.
// the theme-init Script, or anything else above the (dashboard)/portal
// route groups) — those two already have their own error.tsx, which is
// what any ordinary page/action error actually hits; this one only fires
// if the crash happens above both of them. Per Next's own docs
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
// error.md), global-error REPLACES the root layout while active, so it has
// to define its own <html>/<body> rather than relying on app/layout.tsx's —
// deliberately plain inline styles here, not Tailwind classes or this app's
// CSS variables, since the thing that crashed might be upstream of them
// ever having applied.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // Sentry's own documented hook for this file (global-error.tsx is the
  // one boundary that even catches a crash in the root layout itself) — a
  // true no-op without NEXT_PUBLIC_SENTRY_DSN set, same as every other
  // Sentry.init() call in this app.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fafafa", color: "#111" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: 24,
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: 8, color: "#666", maxWidth: 360 }}>
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            onClick={retry}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
