// Mirrors backend/apps/courses/models.py's CourseAttempt/SlideResult and
// serializers.py's CourseAttemptSerializer/SlideResultSerializer — keep in
// sync by hand for now, same convention as accounts-types.ts/course-types.ts
// for their own domains.

export type CourseAttemptStatus = "in_progress" | "completed";

// score/passed are SERVER-COMPUTED — see grading.py. Never set these from
// anything read out of the browser; they only ever come back from a
// djangoFetch response.
export type CourseAttempt = {
  id: string;
  course_version: string;
  user: number;
  status: CourseAttemptStatus;
  started_at: string;
  completed_at: string | null;
  score: number | null; // 0-100
  passed: boolean | null;
};

// The response shape for one slide's result — is_correct/score are
// read-only/server-computed, included here only because the results
// endpoint echoes them back (useful for the live "Score so far" tally to
// reconcile against, though this app doesn't currently bother — see
// course-preview-viewer.tsx's own comment on why it keeps using its local
// optimistic tally instead).
export type SlideResult = {
  id: string;
  attempt: string;
  slide: string;
  detail: unknown;
  is_correct: boolean;
  score: number; // 0-1
};
