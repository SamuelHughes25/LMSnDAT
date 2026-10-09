"use server";

import { revalidatePath } from "next/cache";

import type { Group } from "@/lib/accounts-types";
import { djangoFetch } from "@/lib/django";

export async function createGroup(name: string, description: string): Promise<Group> {
  const group = await djangoFetch<Group>("/groups/", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
  revalidatePath("/groups");
  return group;
}

export async function deleteGroup(groupId: string): Promise<void> {
  await djangoFetch<void>(`/groups/${groupId}/`, { method: "DELETE" });
  revalidatePath("/groups");
}

// Read-modify-write: fetch the group's CURRENT course/template id list, add
// or remove the one id, then PATCH the full replacement array back — the
// only way to change a DRF PrimaryKeyRelatedField(many=True) M2M without a
// dedicated custom action, and the same "send the whole new array" shape
// every other list mutation in this app already uses (e.g. extra_images in
// course-types.ts's SlideConfig). Two separate toggles (course vs
// template) since a group's `courses` and `templates` are independent
// fields on the SAME group — toggling one never touches the other.
export async function toggleCourseInGroup(groupId: string, courseId: string, add: boolean): Promise<Group> {
  const group = await djangoFetch<Group>(`/groups/${groupId}/`);
  const courses = add ? [...new Set([...group.courses, courseId])] : group.courses.filter((id) => id !== courseId);
  const updated = await djangoFetch<Group>(`/groups/${groupId}/`, {
    method: "PATCH",
    body: JSON.stringify({ courses }),
  });
  revalidatePath(`/courses/${courseId}/roles`);
  return updated;
}

export async function toggleTemplateInGroup(groupId: string, templateId: string, add: boolean): Promise<Group> {
  const group = await djangoFetch<Group>(`/groups/${groupId}/`);
  const templates = add
    ? [...new Set([...group.templates, templateId])]
    : group.templates.filter((id) => id !== templateId);
  const updated = await djangoFetch<Group>(`/groups/${groupId}/`, {
    method: "PATCH",
    body: JSON.stringify({ templates }),
  });
  revalidatePath(`/templates/${templateId}/roles`);
  return updated;
}
