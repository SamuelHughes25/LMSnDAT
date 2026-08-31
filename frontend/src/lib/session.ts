import "server-only";

import { cookies } from "next/headers";

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  authCookieOptions,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
} from "./auth-cookies";

type Tokens = { access: string; refresh: string };

export async function setAuthCookies({ access, refresh }: Tokens) {
  const store = await cookies();
  store.set(ACCESS_TOKEN_COOKIE, access, { ...authCookieOptions, maxAge: ACCESS_TOKEN_MAX_AGE });
  store.set(REFRESH_TOKEN_COOKIE, refresh, { ...authCookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE });
}

export async function clearAuthCookies() {
  const store = await cookies();
  store.delete(ACCESS_TOKEN_COOKIE);
  store.delete(REFRESH_TOKEN_COOKIE);
}
