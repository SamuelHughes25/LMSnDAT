import * as Sentry from "@sentry/nextjs";

// Browser-side init — Next's own file convention (runs after the document
// loads, before hydration; see node_modules/next/dist/docs/.../
// instrumentation-client.md). Needs the NEXT_PUBLIC_ prefix specifically
// because this code ships to the browser — Next only inlines env vars with
// that prefix into client bundles, same reasoning as every other
// client-visible config value in this app.
// See sentry.server.config.ts for why there's no `sendDefaultPii` here.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
