"use server";

import type { CourseAttempt, SlideResult } from "@/lib/attempt-types";
import { djangoFetch } from "@/lib/django";

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
