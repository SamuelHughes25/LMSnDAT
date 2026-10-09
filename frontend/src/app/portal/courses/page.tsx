import { PortalCoursesView, type PortalCourseCardData } from "@/components/portal-courses-view";
import { getCourseReminders, reminderReason } from "@/lib/course-reminders";
import type { Course, CourseVersion } from "@/lib/course-types";
import { getCurrentUser } from "@/lib/dal";
import { deadlineStatus } from "@/lib/deadline";
import { djangoFetch } from "@/lib/django";
import { getVisibleCourseIds } from "@/lib/role-access";
import type { Paginated } from "@/lib/types";

// A course only shows here if it's in the assigned role's `courses` list
// (see role-access.ts) — reported directly as a real gap: a member with no
// role at all was still seeing every course that existed, including ones
// never assigned to them. `visibleIds === null` means the viewer is an
// admin/manager (role-scoping doesn't apply to them) or the check is
// otherwise bypassed; a member with no role gets an empty Set, not null,
// so they correctly see nothing rather than everything.
//
// A course only becomes playable once it has a published version: an
// in-progress draft isn't real content for an operative to see, so an
// unpublished-but-visible course still shows up (so nothing is silently
// hidden) but as a disabled, clearly-labeled card instead of a link.
export default async function PortalCoursesPage() {
  const [user, courses, versions, visibleIds] = await Promise.all([
    getCurrentUser(),
    djangoFetch<Paginated<Course>>("/courses/"),
    djangoFetch<Paginated<CourseVersion>>("/course-versions/"),
    getVisibleCourseIds(),
  ]);

  const publishedCourseIds = new Set(
    versions.results.filter((v) => v.status === "published").map((v) => v.course),
  );

  const visibleCourses =
    visibleIds === null ? courses.results : courses.results.filter((course) => visibleIds.has(course.id));

  // Same "why does this course still need me" computation the portal home
  // page's own Reminders section uses (see lib/course-reminders.ts) — shown
  // here too, inline on each card/row, so an operative doesn't have to
  // bounce back to the home page to find out WHY a course is flagged before
  // they even open it.
  const reminders = await getCourseReminders(user, visibleCourses, visibleIds);
  const reminderByCourseId = new Map(reminders.map((r) => [r.course.id, r]));

  // course-reminders.ts and portal-courses-view.tsx are both off-limits to
  // each other (server-only data fetching vs. a "use client" renderer), so
  // this is where the two meet: every course gets fully resolved into plain,
  // serializable props here, once.
  const items: PortalCourseCardData[] = visibleCourses.map((course) => {
    const isPlayable = publishedCourseIds.has(course.id);
    const reminder = reminderByCourseId.get(course.id);
    const deadline = deadlineStatus(course.my_deadline);
    return {
      id: course.id,
      name: course.name,
      description: course.description,
      thumbnail: course.thumbnail,
      href: isPlayable ? `/portal/courses/${course.id}` : null,
      badgeLabel: isPlayable && reminder ? (deadline?.overdue ? "Overdue" : "Action needed") : null,
      reminderReason: reminder ? reminderReason(reminder) : null,
      deadlineLabel: deadline?.label ?? null,
      deadlineOverdue: deadline?.overdue ?? false,
    };
  });

  return (
    // No max-w cap (unlike the portal's other pages) — this page's whole
    // job is showing the course grid/list, so it should use the full width
    // `main` actually has rather than leaving a large, arbitrary blank
    // strip on the right on any screen wider than ~896px — reported
    // directly as "the right side of the page is not being used."
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Courses</h1>
        <p className="mt-1 text-muted-foreground">Pick a course to start.</p>
      </div>

      <PortalCoursesView
        items={items}
        emptyMessage={
          courses.results.length === 0
            ? "No courses have been created yet."
            : "No courses have been assigned to your role yet."
        }
      />
    </div>
  );
}
