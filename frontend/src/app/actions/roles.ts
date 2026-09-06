"use server";

import { revalidatePath } from "next/cache";

import type { JobRole } from "@/lib/accounts-types";
import { djangoFetch } from "@/lib/django";

export async function createRole(name: string, description: string): Promise<JobRole> {
  const role = await djangoFetch<JobRole>("/job-roles/", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
  revalidatePath("/roles");
  return role;
}

export async function deleteRole(roleId: string): Promise<void> {
  await djangoFetch<void>(`/job-roles/${roleId}/`, { method: "DELETE" });
  revalidatePath("/roles");
}

// Read-modify-write: fetch the role's CURRENT course/template id list, add
// or remove the one id, then PATCH the full replacement array back — the
// only way to change a DRF PrimaryKeyRelatedField(many=True) M2M without a
// dedicated custom action, and the same "send the whole new array" shape
// every other list mutation in this app already uses (e.g. extra_images in
// course-types.ts's SlideConfig).
export async function toggleCourseRole(roleId: string, courseId: string, add: boolean): Promise<JobRole> {
  const role = await djangoFetch<JobRole>(`/job-roles/${roleId}/`);
  const courses = add
    ? [...new Set([...role.courses, courseId])]
    : role.courses.filter((id) => id !== courseId);
  const updated = await djangoFetch<JobRole>(`/job-roles/${roleId}/`, {
    method: "PATCH",
    body: JSON.stringify({ courses }),
  });
  revalidatePath(`/courses/${courseId}/roles`);
  return updated;
}

export async function toggleTemplateRole(roleId: string, templateId: string, add: boolean): Promise<JobRole> {
  const role = await djangoFetch<JobRole>(`/job-roles/${roleId}/`);
  const templates = add
    ? [...new Set([...role.templates, templateId])]
    : role.templates.filter((id) => id !== templateId);
  const updated = await djangoFetch<JobRole>(`/job-roles/${roleId}/`, {
    method: "PATCH",
    body: JSON.stringify({ templates }),
  });
  revalidatePath(`/templates/${templateId}/roles`);
  return updated;
}
