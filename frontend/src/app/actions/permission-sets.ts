"use server";

import { revalidatePath } from "next/cache";

import type { PermissionSet } from "@/lib/accounts-types";
import { djangoFetch } from "@/lib/django";

// Same "derive from the type" shape as permissions/page.tsx's TAB_COLUMNS —
// one source of truth (PermissionSet's own fields) for which keys are tabs.
export type PermissionTabField = keyof PermissionSet & `can_access_${string}`;

export async function createPermissionSet(name: string): Promise<PermissionSet> {
  const permissionSet = await djangoFetch<PermissionSet>("/permission-sets/", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  revalidatePath("/permissions");
  return permissionSet;
}

// One checkbox per tab on the list page PATCHes a single field at a
// time — simpler than staging all six in local state behind a save
// button, and matches this app's existing "commit on click" convention
// for toggle-shaped controls (e.g. role-assignment-toggle.tsx).
export async function setPermissionSetTab(
  permissionSetId: string,
  field: PermissionTabField,
  value: boolean,
): Promise<PermissionSet> {
  const updated = await djangoFetch<PermissionSet>(`/permission-sets/${permissionSetId}/`, {
    method: "PATCH",
    body: JSON.stringify({ [field]: value }),
  });
  revalidatePath("/permissions");
  return updated;
}

export async function deletePermissionSet(permissionSetId: string): Promise<void> {
  await djangoFetch<void>(`/permission-sets/${permissionSetId}/`, { method: "DELETE" });
  revalidatePath("/permissions");
}
