import { AdminCoursesView } from "@/components/admin-courses-view";
import { NewCourseDialog } from "@/components/new-course-dialog";
import type { Course } from "@/lib/course-types";
import { getCurrentUser } from "@/lib/dal";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// Server component — re-fetches fresh on every page load (a plain browser
// refresh included, no client cache in the way), so a course someone else
// just added you as an editor on shows up the moment you reload here, no
// special live-sync machinery needed.
export default async function CoursesPage() {
  const user = await getCurrentUser();
  // The ONLY courses that show here are ones the viewer owns or is an
  // editor on — the Courses tab itself no longer means "see the whole
  // catalog" (that changed deliberately: tab access now just gets you
  // into the section and lets you create new courses, which makes you
  // their owner; SEEING a specific course here always requires that
  // owner/editor relationship). is_superuser/is_platform_admin are the
  // one exception, same full-bypass tier as everywhere else in this app.
  const isSuperTier = user.is_superuser || user.is_platform_admin;
  const canAccessCoursesTab = user.accessible_tabs.includes("courses");
  // page_size=200 (this app's configured max) rather than the default 25
  // — a non-super-tier viewer's own course(s) must never fall off a
  // truncated first page before the filter below even runs.
  const data = await djangoFetch<Paginated<Course>>(isSuperTier ? "/courses/" : "/courses/?page_size=200");
  const courses = isSuperTier
    ? data.results
    : data.results.filter((c) => user.manageable_course_ids.includes(c.id));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Courses</h1>
        {/* Creating a course is still gated purely on the Courses tab
            (CourseViewSet.get_permissions' HasDashboardTabAccess fallback
            for `create`) — becoming a course's owner is exactly how
            someone with the tab but no courses yet gets their first one
            to show up here at all. */}
        {canAccessCoursesTab && <NewCourseDialog />}
      </div>
      <div className="mt-4">
        <AdminCoursesView courses={courses} />
      </div>
    </div>
  );
}
