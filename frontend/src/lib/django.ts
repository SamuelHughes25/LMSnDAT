import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACCESS_TOKEN_COOKIE } from "./auth-cookies";

// Internal, server-to-server URL only — Django is never called from the
// browser. Defaults to localhost for running the frontend outside Docker;
// docker-compose overrides this to the "web" service's internal address.
// See docs/PROJECT_LOG.md for the BFF rationale.
const DJANGO_API_URL = process.env.DJANGO_API_URL ?? "http://localhost:8000/api/v1";

export class DjangoApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Server-only fetch helper for Server Components/Actions to call Django
 * directly, attaching the caller's access token cookie. Do not call from
 * client components — this file is guarded by `server-only`. */
export async function djangoFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;

  const res = await fetch(`${DJANGO_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });

  if (res.status === 401) {
    // Access token missing/expired and proxy.ts didn't catch it (e.g. it
    // expired mid-render). Bounce to login rather than surface a raw 401.
    redirect("/login");
  }

  if (!res.ok) {
    const body = await res.text();
    throw new DjangoApiError(res.status, body || res.statusText);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
