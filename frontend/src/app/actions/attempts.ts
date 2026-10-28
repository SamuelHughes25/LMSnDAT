"use server";

import type { CourseAttempt, SlideResult } from "@/lib/attempt-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// Read-only check for the course player's own "Continue where you left off,
// or start again?" prompt (see course-preview-viewer.tsx) — unlike
// startCourseAttempt, this never creates anything, so it's safe to call
// before the learner has made that choice. Already scoped to "my own
// attempts only" for a member by CourseAttemptViewSet.get_queryset's own
// role-scoping, same as startCourseAttempt.
export async function getInProgressAttempt(courseVersionId: string): Promise<CourseAttempt | null> {
  const results = await djangoFetch<Paginated<CourseAttempt>>(
    `/course-attempts/?course_version=${courseVersionId}&status=in_progress`,
  );
  return results.results[0] ?? null;
}

// "Start again": discards the still-in_progress attempt outright (its
// SlideResults cascade-delete with it — see CourseAttempt's FK on the
// backend) so startCourseAttempt's own resume-or-create call genuinely
// creates a fresh one afterward, rather than resuming the very attempt the
// learner just chose to abandon. Only ever called on an IN_PROGRESS attempt
// — a COMPLETED one's score/answers are the permanent record "Retake"
// already preserves by creating an entirely new attempt instead.
export async function discardCourseAttempt(attemptId: string): Promise<void> {
  await djangoFetch<void>(`/course-attempts/${attemptId}/`, { method: "DELETE" });
}

// RESUMES the caller's own existing in_progress attempt at this course
// version if one already exists, rather than always creating a new one —
// see CourseAttemptViewSet.perform_create for why this is handled
// server-side (atomically, backed by a real DB constraint) rather than as a
// separate client-side "check, then create" call.
export async function startCourseAttempt(courseVersionId: string): Promise<CourseAttempt> {
  return djangoFetch<CourseAttempt>("/course-attempts/", {
    method: "POST",
    body: JSON.stringify({ course_version: courseVersionId }),
  });
}

// Deliberately takes only `detail` (the raw, type-specific answer payload
// — see grading.py's own module docstring for the shape per slide_type),
// never `isCorrect`/`score` — those fields exist on the frontend's own
// SlideInteractionResult (slide-interaction.ts) purely for the live,
// client-side "Score so far" tally's instant feedback, but they're never
// read by this call. The server independently grades `detail` against the
// slide's own config and returns the authoritative is_correct/score;
// nothing the browser computed is ever trusted for what actually counts
// toward a pass/fail.
export async function submitSlideResult(
  attemptId: string,
  slideId: string,
  detail: unknown,
): Promise<SlideResult> {
  const results = await djangoFetch<SlideResult[]>(`/course-attempts/${attemptId}/results/`, {
    method: "POST",
    body: JSON.stringify({ results: [{ slide: slideId, detail }] }),
  });
  return results[0];
}

export async function completeCourseAttempt(attemptId: string): Promise<CourseAttempt> {
  return djangoFetch<CourseAttempt>(`/course-attempts/${attemptId}/complete/`, {
    method: "POST",
  });
}
