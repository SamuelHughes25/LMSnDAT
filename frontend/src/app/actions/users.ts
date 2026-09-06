"use server";

import { revalidatePath } from "next/cache";

import type { AccountUser, UserRole } from "@/lib/accounts-types";
import { djangoFetch } from "@/lib/django";

export async function createUser(
  username: string,
  password: string,
  role: UserRole,
  jobRoleId: string | null,
): Promise<AccountUser> {
  const user = await djangoFetch<AccountUser>("/users/", {
    method: "POST",
    body: JSON.stringify({ username, password, role, job_role: jobRoleId }),
  });
  revalidatePath("/users");
  return user;
}

export async function updateUserJobRole(userId: number, jobRoleId: string | null): Promise<AccountUser> {
  const user = await djangoFetch<AccountUser>(`/users/${userId}/`, {
    method: "PATCH",
    body: JSON.stringify({ job_role: jobRoleId }),
  });
  revalidatePath("/users");
  return user;
}

export async function deleteUser(userId: number): Promise<void> {
  await djangoFetch<void>(`/users/${userId}/`, { method: "DELETE" });
  revalidatePath("/users");
}
