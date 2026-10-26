"use server";

import { revalidatePath } from "next/cache";

import type { PermissionSet } from "@/lib/accounts-types";
import { djangoFetch } from "@/lib/django";

// Same "derive from the type" shape as permissions/page.tsx's TAB_COLUMNS —
// one source of truth (PermissionSet's own fields) for which keys are tabs.
// Widened from `can_access_${string}` to `can_${string}` so this also
// covers the sub-permission flags (can_create_users, can_edit_users,
// can_edit_course_members, etc.) — every boolean flag on PermissionSet
// follows this same "can_..." naming, tab-access and sub-permission
// alike, so one pattern covers both.
export type PermissionTabField = keyof PermissionSet & `can_${string}`;

// `fields` carries every can_* checkbox from the create/edit dialog's tab
// strip in one go — the dialog stages the whole form locally and commits
// it as a single request on submit, replacing the old "one checkbox,
// immediate PATCH per click" convention the table used before the
// dedicated dialog existed.
export async function createPermissionSet(
  name: string,
  fields: Partial<Record<PermissionTabField, boolean>>,
): Promise<PermissionSet> {
  const permissionSet = await djangoFetch<PermissionSet>("/permission-sets/", {
    method: "POST",
    body: JSON.stringify({ name, ...fields }),
  });
  revalidatePath("/permissions");
  return permissionSet;
}

export async function updatePermissionSet(
  permissionSetId: string,
  name: string,
  fields: Partial<Record<PermissionTabField, boolean>>,
): Promise<PermissionSet> {
  const updated = await djangoFetch<PermissionSet>(`/permission-sets/${permissionSetId}/`, {
    method: "PATCH",
    body: JSON.stringify({ name, ...fields }),
  });
  revalidatePath("/permissions");
  return updated;
}

export async function deletePermissionSet(permissionSetId: string): Promise<void> {
  await djangoFetch<void>(`/permission-sets/${permissionSetId}/`, { method: "DELETE" });
  revalidatePath("/permissions");
}
