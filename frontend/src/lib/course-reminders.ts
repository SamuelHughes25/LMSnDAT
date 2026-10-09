import "server-only";

import type { CourseAttempt } from "./attempt-types";
import type { Course } from "./course-types";
import type { CurrentUser } from "./dal";
import { djangoFetch } from "./django";
import type { Paginated } from "./types";

export type CourseReminder = { course: Course; kind: "assessment" | "deadline-only" };

// Shared by the portal home page's "Reminders" section AND the Courses
// list page (each course card shows the same reason inline) — one
// computation of "why does this course still need my attention," not two
// that could drift apart.
//
// Covers two independent reasons a course needs one (deadline is
// independent of is_assessment — see Course.deadline's own comment in
// backend/apps/courses/models.py, e.g. a purely informative onboarding
// course can still need a "watch this in your first week" deadline with no
// questions at all):
//  - "assessment": is_assessment + a passing_score set, and the member
//    hasn't yet passed it (ANY of their own attempts has passed=true).
//  - "deadline-only": not an assessment, but has a deadline, and the
//    member has no COMPLETED attempt yet — there's no score to fail, so
//    checking `passed` here would (since it's always null for a
//    non-assessment course) wrongly keep reminding someone forever even
//    after they genuinely finished it.
// CourseAttempt's role-scoping already limits /course-attempts/?course=<id>
// to a member's own rows, so no extra user filter is needed here. One
// fetch per relevant course (rather than one big fetch + a
// course_version->course lookup) since there's typically only a handful
// visible to any one member — simplest correct option at this app's scale.
// Admins/managers never get real reminders here (they're not the ones with
// a personal course to complete) — an empty list is the correct result for
// them, not an error.
export async function getCourseReminders(
  user: CurrentUser,
  courses: Course[],
  visibleIds: Set<string> | null,
): Promise<CourseReminder[]> {
  if (user.role !== "member") return [];
  const relevant = courses.filter(
    (c) => (visibleIds === null || visibleIds.has(c.id)) && (c.is_assessment || c.deadline !== null),
  );
  if (relevant.length === 0) return [];
  const results = await Promise.all(
    relevant.map(async (course): Promise<CourseReminder | null> => {
      const attempts = await djangoFetch<Paginated<CourseAttempt>>(`/course-attempts/?course=${course.id}`);
      const isFinished = course.is_assessment
        ? attempts.results.some((a) => a.passed === true)
        : attempts.results.some((a) => a.status === "completed");
      if (isFinished) return null;
      return { course, kind: course.is_assessment ? "assessment" : "deadline-only" };
    }),
  );
  return results.filter((r): r is CourseReminder => r !== null);
}

// The plain-English reason line for one reminder — shared so the home
// page's reminder card and the Courses list page's inline badge say
// exactly the same thing for the same course.
export function reminderReason(reminder: CourseReminder): string {
  return reminder.kind === "assessment"
    ? `You haven't passed this yet — minimum ${reminder.course.passing_score}% required.`
    : "You haven't completed this yet.";
}
