// Shared between server-only helpers (lib/session.ts, lib/django.ts, which
// use next/headers `cookies()`) and proxy.ts (which uses the NextRequest/
// NextResponse cookie APIs instead). Kept dependency-free so both can import
// it without pulling in next/headers.

export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";

// Mirrors backend/config/settings/base.py SIMPLE_JWT lifetimes.
export const ACCESS_TOKEN_MAX_AGE = 60 * 15;
export const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 7;

export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
