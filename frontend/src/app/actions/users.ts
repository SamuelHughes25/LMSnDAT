"use server";

import { revalidatePath } from "next/cache";

import type { AccountUser, UserRole } from "@/lib/accounts-types";
import { DjangoApiError, djangoFetch, extractErrorDetail } from "@/lib/django";

// DjangoApiError's `message` is the raw DRF response body (djangoFetch does
// `await res.text()`, not `.json()`). A validation error here is normally
// per-field — `{"username": ["A user with that username already exists."]}`,
// `{"password": [...]}`, `{"role": [...]}` — not the single `{"detail":...}`
// shape deleteUser (below) parses, so this generically takes the first
// string found anywhere in the body rather than assuming one specific key.
// Same "first string anywhere in the body" fallback shape as
// describeAssignmentError in actions/courses.ts.
function describeUserCreateError(err: DjangoApiError): string {
  try {
    const body: unknown = JSON.parse(err.message);
    if (body && typeof body === "object") {
      if ("detail" in body && typeof body.detail === "string") return body.detail;
      for (const value of Object.values(body)) {
        if (typeof value === "string") return value;
        if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      }
    }
  } catch {
    // Not JSON — fall through to the generic message below.
  }
  return `Something went wrong (status ${err.status}).`;
}

// Returns a result object rather than letting a DjangoApiError propagate —
// the dialog used to show one hardcoded "username may already be taken"
// string for EVERY failure (a bare `catch {}` with no bound parameter,
// discarding whatever actually went wrong — a password-validation error, a
// role issue, a permission error, all looked identical). Mirrors
// addCourseAssignment's "expected errors as return values" shape in
// actions/courses.ts.
// permissionSetId is only meaningful for a dashboard user (role !==
// "member") — a portal operative never reaches the dashboard at all, so
// there's nothing for a permission set to grant them (see PermissionSet's
// own comment in accounts-types.ts). Omitted/null just leaves the new
// user with no dashboard access until someone assigns one later.
export async function createUser(
  username: string,
  password: string,
  role: UserRole,
  permissionSetId?: string | null,
): Promise<{ ok: true; user: AccountUser } | { ok: false; error: string }> {
  try {
    const user = await djangoFetch<AccountUser>("/users/", {
      method: "POST",
      body: JSON.stringify({ username, password, role, permission_set: permissionSetId ?? null }),
    });
    revalidatePath("/users");
    return { ok: true, user };
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 400) {
      return { ok: false, error: describeUserCreateError(err) };
    }
    throw err;
  }
}

// A plain PATCH — permission_set is an ordinary writable field (see
// UserSerializer), same as role/team.
export async function setUserPermissionSet(
  userId: number,
  permissionSetId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<AccountUser>(`/users/${userId}/`, {
      method: "PATCH",
      body: JSON.stringify({ permission_set: permissionSetId }),
    });
    revalidatePath(`/users/${userId}`);
    revalidatePath("/users");
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError) return { ok: false, error: err.message };
    throw err;
  }
}

// A plain PATCH — role is an ordinary writable field (see UserSerializer),
// guarded the same way the rest of UserViewSet.update() already is (the
// super-super-user's own row can't be touched by anyone else, a super
// user's row can't be touched by anyone but the super-super-user) — no
// extra checks needed here, the backend 400s and describeUserCreateError
// surfaces whatever it says. This is what makes "promote an operative to
// a manager" or "move an office user back to an operative role" actually
// change which dashboard content they land on — (dashboard)/dashboard/
// page.tsx's own home screen branches on exactly this field, independent
// of whatever tabs a permission set/Super User grant separately opens up
// in the sidebar.
export async function setUserRole(userId: number, role: UserRole): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<AccountUser>(`/users/${userId}/`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
    revalidatePath(`/users/${userId}`);
    revalidatePath("/users");
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError) return { ok: false, error: describeUserCreateError(err) };
    throw err;
  }
}

// Both gated server-side to IsSuperuser — "only me the super super user
// can do this," per the user's own words. A non-superuser attempting
// either gets a clean 403, surfaced as the error string below.
export async function grantPlatformAdmin(userId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<AccountUser>(`/users/${userId}/grant-platform-admin/`, { method: "POST" });
    // Missing the list revalidation was a real, reported bug: the Users
    // table's own "Access"/"Permission" columns (users/page.tsx) kept
    // showing the pre-grant state until some unrelated navigation happened
    // to revalidate "/users" — this is what actually refreshes them right
    // away. Mirrors setUserPermissionSet's identical two-path revalidation
    // just above.
    revalidatePath(`/users/${userId}`);
    revalidatePath("/users");
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function revokePlatformAdmin(userId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<AccountUser>(`/users/${userId}/revoke-platform-admin/`, { method: "POST" });
    revalidatePath(`/users/${userId}`);
    revalidatePath("/users");
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError) return { ok: false, error: err.message };
    throw err;
  }
}

// DELETE now archives (deactivates — is_active=False, which already
// blocks login via Django's own auth backend) rather than hard-deleting
// (see the backend's UserViewSet.destroy) — mirrors deleteCourse/
// deleteTemplate in actions/courses.ts/templates.ts exactly. The real,
// final hard delete only lives behind purgeUser below now, reachable only
// from the Archive page.
export async function deleteUser(userId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<void>(`/users/${userId}/`, { method: "DELETE" });
    revalidatePath("/users");
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 400) {
      let detail = "This user can't be archived right now.";
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

// --- Archive ---

export async function restoreUser(userId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<AccountUser>(`/users/${userId}/restore/`, { method: "POST" });
    revalidatePath("/archive");
    revalidatePath("/users");
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError) return { ok: false, error: err.message };
    throw err;
  }
}

// The real, final hard delete. Deliberately does NOT cascade-purge a
// user's own authored content — if they own a course/template (PROTECT),
// the backend blocks this with an explicit "owns X" message instead (see
// UserViewSet.purge's own comment for why: ownership transfer is tracked
// as a separate follow-up, this is the safe interim behavior). Any other
// PROTECT (e.g. the user's own CourseAttempt history as a learner) comes
// back as the backend's usual generic "still referenced by" message.
export type PurgeUserResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      // Set only for the "owns content" block — named, not just counted,
      // so the Archive page can link straight to each one's Members tab
      // instead of just telling the admin a number they can't act on.
      // See UserViewSet.purge's matching 'owned_courses'/'owned_templates'.
      ownedCourses?: { id: string; name: string }[];
      ownedTemplates?: { id: string; name: string }[];
    };

export async function purgeUser(userId: number): Promise<PurgeUserResult> {
  try {
    await djangoFetch<void>(`/users/${userId}/purge/`, { method: "POST" });
    revalidatePath("/archive");
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 400) {
      let detail = "This user can't be permanently deleted.";
      let ownedCourses: { id: string; name: string }[] | undefined;
      let ownedTemplates: { id: string; name: string }[] | undefined;
      try {
        const body: unknown = JSON.parse(err.message);
        if (body && typeof body === "object") {
          if ("detail" in body && typeof body.detail === "string") {
            detail = body.detail;
          }
          if ("owned_courses" in body && Array.isArray(body.owned_courses)) {
            ownedCourses = body.owned_courses as { id: string; name: string }[];
          }
          if ("owned_templates" in body && Array.isArray(body.owned_templates)) {
            ownedTemplates = body.owned_templates as { id: string; name: string }[];
          }
        }
      } catch {
        // Not JSON — fall back to the generic message above.
      }
      return { ok: false, error: detail, ownedCourses, ownedTemplates };
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

// --- Self-service account ---

export type ChangePasswordState = { error?: string; success?: boolean } | undefined;

// Deliberately the same useActionState-driven `(prevState, formData)`
// shape as actions/auth.ts's own `login` — this is also a bare credential
// form (old password + new password, not an admin action against someone
// ELSE's record), so it follows that convention rather than the
// `{ok,error}`-result-union + imperative-djangoFetch shape the rest of
// this file uses for admin-side user management.
//
// Calls the backend's self-service `/users/change-password/` action (NOT
// a PATCH to `/users/{id}/` with a new `password` value — that's the
// EXISTING admin-reset path, reachable only with dashboard access to the
// Users tab, and doesn't require knowing the account's current password
// at all). This one works for every account regardless of role/tab
// access — see that action's own comment in the backend.
export async function changeOwnPassword(_prevState: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const oldPassword = formData.get("old_password");
  const newPassword = formData.get("new_password");
  const confirmPassword = formData.get("confirm_password");

  if (
    typeof oldPassword !== "string" ||
    typeof newPassword !== "string" ||
    typeof confirmPassword !== "string" ||
    !oldPassword ||
    !newPassword ||
    !confirmPassword
  ) {
    return { error: "All fields are required." };
  }
  if (newPassword !== confirmPassword) {
    return { error: "New passwords don't match." };
  }

  try {
    await djangoFetch<void>("/users/change-password/", {
      method: "POST",
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    return { success: true };
  } catch (err) {
    const detail = extractErrorDetail(err, "Couldn't change your password right now.");
    if (detail !== null) return { error: detail };
    throw err;
  }
}

// Admin-side reset of SOMEONE ELSE's password, distinct from
// changeOwnPassword above (which requires the account's own current
// password, used from /account for self-service changes). This goes
// through UserSerializer's ordinary writable `password` field — a plain
// PATCH, the exact same mechanism createUser's own password already
// uses, never the account's current credential — so there's nothing new
// to build server-side. Reported directly as a real need: mistyping a
// password when creating an account used to have no fix short of
// archiving and recreating the whole user.
export async function adminResetUserPassword(
  userId: number,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<AccountUser>(`/users/${userId}/`, {
      method: "PATCH",
      body: JSON.stringify({ password: newPassword }),
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError) return { ok: false, error: describeUserCreateError(err) };
    throw err;
  }
}
