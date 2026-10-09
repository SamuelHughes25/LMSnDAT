import * as Sentry from "@sentry/nextjs";

// Server-runtime (Node.js) init — imported by instrumentation.ts, never
// imported directly anywhere else. A true no-op without NEXT_PUBLIC_SENTRY_DSN
// set (every local/test environment today) — same reasoning as the backend's
// settings/base.py: this file still runs, but Sentry.init() with an empty
// dsn just means the SDK captures nothing and makes no network calls.
// No `sendDefaultPii` here — unlike the Python SDK (backend/config/settings
// /base.py's send_default_pii=False), this JS SDK version (11.6.0, confirmed
// against its own shipped .d.ts files — no such option exists) doesn't
// auto-attach PII like IP addresses/cookies without it being fed in
// explicitly (e.g. a manual Sentry.setUser() call, which this app never
// makes), so there's no equivalent flag needed to keep that off by default.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
