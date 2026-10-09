import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Traces each page's actual dependencies and emits a self-contained
  // .next/standalone/server.js + a pruned node_modules — Dockerfile.prod's
  // whole point (a production image that doesn't need `npm ci` with full
  // devDependencies baked in). No effect on `next dev` (dev's own
  // Dockerfile is untouched, still plain `next dev`), only on `next build`.
  output: "standalone",
  experimental: {
    serverActions: {
      // Next.js Server Actions cap request bodies at 1MB by default —
      // fine for the JSON-only actions elsewhere in this app, but
      // uploadCourseAsset (app/actions/courses.ts) sends the actual image
      // FILE through a Server Action as FormData, and any real photo
      // comfortably exceeds 1MB. Confirmed via a real browser + the dev
      // server's own log: a 14MB test photo failed with "Error: Body
      // exceeded 1 MB limit" (a 413, thrown by Next.js itself before the
      // request ever reaches Django) while every earlier test — all using
      // small synthetic images well under 1MB — worked fine, which is why
      // this went unnoticed until a realistically-sized photo was tried.
      bodySizeLimit: "15mb",
    },
    // A SEPARATE 10MB default cap, independent of the one above: proxy.ts
    // (this app's auth-refresh middleware) runs on every request including
    // this upload, and Next.js buffers a clone of the body for it to read.
    // Raising just serverActions.bodySizeLimit above was not enough on its
    // own — confirmed via the dev server's log, which after that fix
    // switched from a clean 413 to a corrupted-body "Error: Unexpected end
    // of form" once the file passed 10MB, silently truncated by *this*
    // separate limit instead. Matches serverActions' own limit so neither
    // one is the tighter bottleneck.
    proxyClientMaxBodySize: "15mb",
  },
};

// Wraps the config to upload source maps to Sentry at build time (readable
// stack traces instead of minified ones) — org/project/authToken are all
// optional here deliberately: with none of them set (every environment
// today, including this sandbox), the build plugin just skips the upload
// step rather than failing the build — confirmed directly by building
// with no SENTRY_AUTH_TOKEN set, not assumed. silent avoids its log noise
// outside CI.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
});
