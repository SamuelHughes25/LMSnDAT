"use server";

import { redirect } from "next/navigation";

import { clearAuthCookies, setAuthCookies } from "@/lib/session";

const DJANGO_API_URL = process.env.DJANGO_API_URL ?? "http://localhost:8000/api/v1";

export type LoginState = { error?: string } | undefined;

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const username = formData.get("username");
  const password = formData.get("password");

  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return { error: "Username and password are required." };
  }

  const res = await fetch(`${DJANGO_API_URL}/auth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    cache: "no-store",
  });

  if (!res.ok) {
    return { error: "Invalid username or password." };
  }

  const { access, refresh } = (await res.json()) as { access: string; refresh: string };
  await setAuthCookies({ access, refresh });

  // Every account lands at "/dashboard" now, regardless of role — it's the
  // one unified Dashboard destination for everyone (see
  // (dashboard)/dashboard/page.tsx, which branches its own content by
  // role) now that app-shell.tsx gives operatives and office users the
  // same nav. "/portal" still exists but only as a redirect to here, so
  // sending everyone here directly avoids that extra hop for operatives
  // specifically. "/" itself is the public marketing home page now (see
  // app/(marketing)) — signed-in traffic never lands there.
  redirect("/dashboard");
}

export async function logout() {
  await clearAuthCookies();
  redirect("/login");
}
