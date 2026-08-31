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
  redirect("/");
}

export async function logout() {
  await clearAuthCookies();
  redirect("/login");
}
