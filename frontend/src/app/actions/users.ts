"use server";

import { revalidatePath } from "next/cache";

import type { AccountUser, UserRole } from "@/lib/accounts-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";

export async function createUser(username: string, password: string, role: UserRole): Promise<AccountUser> {
  const user = await djangoFetch<AccountUser>("/users/", {
    method: "POST",
    body: JSON.stringify({ username, password, role }),
  });
  revalidatePath("/users");
  return user;
}

// Almost any real user ends up referenced by an on_delete=PROTECT foreign
// key somewhere (they created a course, took one, were directly assigned
// one — see apps/core/exceptions.py's own comment on the backend for the
// full list and why PROTECT, deliberately, on an audit-compliance
// platform). Django's delete collector blocks that deletion outright; the
// backend's global exception handler turns it into a clean 400 with a
// `detail` message rather than a 500, and this returns a result object
// (same "expected errors as return values" reasoning as
// addCourseAssignment in actions/courses.ts) so delete-user-button.tsx can
// show that message instead of crashing to the dashboard error boundary.
export async function deleteUser(userId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<void>(`/users/${userId}/`, { method: "DELETE" });
    revalidatePath("/users");
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 400) {
      let detail = "This user can't be deleted — they still have records attached to their account.";
      try {
        const body: unknown = JSON.parse(err.message);
        if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
          detail = body.detail;
        }
      } catch {
        // Not JSON — fall back to the generic message above.
      }
      return { ok: false, error: detail };
    }
    throw err;
  }
}

// Read-modify-write on the user's own content_groups array — same pattern
// as toggleCourseInGroup/toggleTemplateInGroup in actions/groups.ts used
// to apply from the group's side; this is the mirror image, applied from
// the user's side, since the user detail page manages a user's groups
// directly rather than editing each group's own member list.
export async function addUserToGroup(userId: number, groupId: string): Promise<AccountUser> {
  const user = await djangoFetch<AccountUser>(`/users/${userId}/`);
  if (!user.content_groups.includes(groupId)) {
    await djangoFetch<AccountUser>(`/users/${userId}/`, {
      method: "PATCH",
      body: JSON.stringify({ content_groups: [...user.content_groups, groupId] }),
    });
  }
  revalidatePath(`/users/${userId}`);
  return user;
}

export async function removeUserFromGroup(userId: number, groupId: string): Promise<AccountUser> {
  const user = await djangoFetch<AccountUser>(`/users/${userId}/`);
  const updated = await djangoFetch<AccountUser>(`/users/${userId}/`, {
    method: "PATCH",
    body: JSON.stringify({ content_groups: user.content_groups.filter((id) => id !== groupId) }),
  });
  revalidatePath(`/users/${userId}`);
  return updated;
}
