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
  // Read-only conveniences, always present on a GET — let a cross-course
  // view (the user detail page's course history, listing attempts across
  // EVERY course) label each attempt without resolving course_version ->
  // course itself via extra round-trips.
  course_id: string;
  course_name: string;
  user: number;
  // Denormalized straight onto the attempt — same *_username convenience
  // precedent as course_id/course_name above — so a caller building a
  // per-course analytics view can label/filter by the attempting user's
  // own username/role/permission set without a separate per-user fetch,
  // which is gated behind the Users tab and 404s for anyone else once the
  // viewer lacks it (see CourseAttemptSerializer's own comment on the
  // backend for the exact bug this was closing).
  user_username: string;
  user_role: string;
  user_permission_set_id: string | null;
  user_permission_set_name: string | null;
  status: CourseAttemptStatus;
  started_at: string;
  completed_at: string | null;
  score: number | null; // 0-100
  passed: boolean | null;
  // Every slide already submitted on this attempt — used to RESUME an
  // in_progress attempt's local `results` state (see course-preview-viewer.tsx)
  // instead of starting blank on a page reload or a new tab. Always present
  // on a GET (the backend serializer includes it unconditionally), so this
  // isn't optional the way it might look.
  slide_results: SlideResult[];
};

// A per-user override of a course's default `deadline` — see
// Course.effective_deadline_for() in backend/apps/courses/models.py for
// how this is actually resolved (this extension wins if one exists, else
// the course's own `deadline` applies).
export type CourseDeadlineExtension = {
  id: string;
  course: string;
  user: number;
  extended_deadline: string;
  created_at: string;
  updated_at: string;
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
