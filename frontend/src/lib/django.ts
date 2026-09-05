import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "./auth-cookies";
import { setAuthCookies } from "./session";

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

// Access tokens only live 15 minutes (see auth-cookies.ts); proxy.ts renews
// them on every page navigation, but a client component calling a Server
// Action directly (e.g. useImageUpload's uploadCourseAsset call, fired from
// a "browse files"/paste handler, not a <form action>) never goes through
// that — the builder can sit open for well over 15 minutes between full page
// loads while the author keeps uploading images or editing slides. Without
// this, that 401 fell straight to the redirect("/login") below, and — since
// this call chain isn't a real page navigation — that redirect's special
// throw doesn't navigate anywhere; it just gets caught by the calling code's
// own try/catch (e.g. useImageUpload's, showing a generic "Upload failed")
// instead. Mirrors proxy.ts's own refresh call, just from the Node runtime
// instead of the edge one, so it can't share that code directly.
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch(`${DJANGO_API_URL}/auth/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: refreshToken }),
    cache: "no-store",
  });
  if (!res.ok) return null;

  const { access, refresh } = (await res.json()) as { access: string; refresh: string };
  try {
    // Persists the refreshed tokens for future requests. Only legal from a
    // Server Action/Route Handler — a plain Server Component render (a page
    // fetching data) can't write cookies, but the refreshed access token
    // below still lets *this* request succeed either way; proxy.ts will
    // persist a refreshed cookie on the next real navigation regardless.
    await setAuthCookies({ access, refresh });
  } catch {
    // Expected in a Server Component render; see above.
  }
  return access;
}

/** Server-only fetch helper for Server Components/Actions to call Django
 * directly, attaching the caller's access token cookie. Do not call from
 * client components — this file is guarded by `server-only`. */
export async function djangoFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const store = await cookies();
  let accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;

  // A FormData body (file uploads — see uploadCourseAsset in
  // app/actions/courses.ts) must NOT get a hardcoded "application/json"
  // Content-Type: fetch needs to set its own multipart/form-data header with
  // the correct boundary, which it only does when no Content-Type is
  // already present. Every other call site in this app passes a
  // JSON.stringify'd body, so this only changes behavior for FormData.
  const isFormData = init.body instanceof FormData;

  async function doFetch(token: string | undefined) {
    return fetch(`${DJANGO_API_URL}${path}`, {
      ...init,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
  }

  let res = await doFetch(accessToken);

  if (res.status === 401) {
    const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
    const refreshed = refreshToken ? await refreshAccessToken(refreshToken) : null;
    if (refreshed) {
      accessToken = refreshed;
      res = await doFetch(accessToken);
    }
  }

  if (res.status === 401) {
    // Refresh token missing/also expired — a real, fully-expired session,
    // not just a stale 15-minute access token. Bounce to login rather than
    // surface a raw 401.
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
