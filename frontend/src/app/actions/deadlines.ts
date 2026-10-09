"use server";

import { revalidatePath } from "next/cache";

import type { CourseDeadlineExtension } from "@/lib/attempt-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// At most one extension per (course, user) — see CourseDeadlineExtension's
// own doc comment in backend/apps/courses/models.py. Finds the existing
// row (if any) so the caller can decide create vs. update.
export async function getDeadlineExtension(courseId: string, userId: number): Promise<CourseDeadlineExtension | null> {
  const page = await djangoFetch<Paginated<CourseDeadlineExtension>>(
    `/course-deadline-extensions/?course=${courseId}&user=${userId}`,
  );
  return page.results[0] ?? null;
}

// Sets (creating or replacing) this one user's effective deadline for this
// course — the "this person genuinely needs more time" escape hatch,
// surfaced from the course's own per-user analytics table rather than a
// separate page, since that's where an admin/manager is already looking
// when they'd realistically decide someone needs an extension.
export async function setDeadlineExtension(
  courseId: string,
  userId: number,
  extendedDeadline: string,
): Promise<CourseDeadlineExtension> {
  const existing = await getDeadlineExtension(courseId, userId);
  const extension = existing
    ? await djangoFetch<CourseDeadlineExtension>(`/course-deadline-extensions/${existing.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ extended_deadline: extendedDeadline }),
      })
    : await djangoFetch<CourseDeadlineExtension>("/course-deadline-extensions/", {
        method: "POST",
        body: JSON.stringify({ course: courseId, user: userId, extended_deadline: extendedDeadline }),
      });
  revalidatePath(`/courses/${courseId}/analytics`);
  return extension;
}

export async function removeDeadlineExtension(courseId: string, userId: number): Promise<void> {
  const existing = await getDeadlineExtension(courseId, userId);
  if (!existing) return;
  await djangoFetch<void>(`/course-deadline-extensions/${existing.id}/`, { method: "DELETE" });
  revalidatePath(`/courses/${courseId}/analytics`);
}
