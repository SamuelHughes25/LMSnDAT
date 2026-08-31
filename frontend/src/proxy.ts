import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  authCookieOptions,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
} from "@/lib/auth-cookies";

const DJANGO_API_URL = process.env.DJANGO_API_URL ?? "http://localhost:8000/api/v1";
const PUBLIC_PATHS = ["/login"];

// Optimistic check only: decodes the JWT payload without verifying the
// signature, purely to decide whether proxy should attempt a refresh before
// routing. Django re-verifies the real signature on every API call, so a
// forged/tampered token here just means an extra round trip that Django
// then rejects with a real 401 — not a security boundary in itself.
function isJwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as { exp: number };
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

async function refreshTokens(refreshToken: string) {
  const res = await fetch(`${DJANGO_API_URL}/auth/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: refreshToken }),
    cache: "no-store",
  });

  if (!res.ok) return null;
  return (await res.json()) as { access: string; refresh: string };
}

function withAuthCookies(response: NextResponse, tokens: { access: string; refresh: string }) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.access, {
    ...authCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh, {
    ...authCookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const hasValidAccess = Boolean(accessToken && !isJwtExpired(accessToken));

  if (hasValidAccess) {
    return isPublicPath ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }

  if (refreshToken) {
    const refreshed = await refreshTokens(refreshToken);
    if (refreshed) {
      const response = isPublicPath
        ? NextResponse.redirect(new URL("/", request.url))
        : NextResponse.next();
      return withAuthCookies(response, refreshed);
    }
  }

  return isPublicPath ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
