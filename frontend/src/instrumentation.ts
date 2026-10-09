import type { Instrumentation } from "next";

// Next's own file convention (node_modules/next/dist/docs/.../instrumentation.md)
// — `register()` runs once per server instance, before it accepts requests;
// `onRequestError` reports server-side errors (Server Components, Route
// Handlers, Server Actions, the proxy) to Sentry. This file itself must stay
// free of top-level Sentry imports — only ever reach the SDK through the
// runtime-specific config files below, each gated on NEXT_RUNTIME, which is
// what keeps edge bundles from pulling in Node-only Sentry code.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  // captureRequestError itself is synchronous (see @sentry/nextjs's own
  // types) — only the import is awaited.
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
