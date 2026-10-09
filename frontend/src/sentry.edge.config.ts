import * as Sentry from "@sentry/nextjs";

// Edge-runtime init — imported by instrumentation.ts for NEXT_RUNTIME ===
// "edge". This app's own proxy.ts (the only thing that could run on the
// edge runtime) defaults to the Node.js runtime (see docs/PROJECT_LOG.md),
// so this branch is dormant today, not dead — included so nothing silently
// goes unmonitored if that ever changes, same no-op-without-a-DSN shape as
// sentry.server.config.ts.
// See sentry.server.config.ts for why there's no `sendDefaultPii` here.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
