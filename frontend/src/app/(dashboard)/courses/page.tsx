import { AdminCoursesView } from "@/components/admin-courses-view";
import { NewCourseDialog } from "@/components/new-course-dialog";
import type { Course } from "@/lib/course-types";
import { getCurrentUser } from "@/lib/dal";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

export default async function CoursesPage() {
  const user = await getCurrentUser();
  // A tab-less owner/editor only reaches this page via the scoped-down nav
  // link app-shell.tsx shows them (see hasManageableCourses there) — fetch
  // page_size=200 (this app's configured max, same convention as e.g.
  // users/[id]/page.tsx's own attempts fetch) rather than the default
  // page_size=25, so their own course can't fall off a truncated first
  // page before the filter below even runs.
  const hasFullAccess = user.accessible_tabs.includes("courses");
  const data = await djangoFetch<Paginated<Course>>(hasFullAccess ? "/courses/" : "/courses/?page_size=200");
  const courses = hasFullAccess
    ? data.results
    : data.results.filter((c) => user.manageable_course_ids.includes(c.id));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Courses</h1>
        {/* Creating a brand-new course is tab-gated on the backend
            (CourseViewSet.get_permissions falls through to
            HasDashboardTabAccess for `create`) regardless of ownership —
            hidden here too so a scoped editor never sees a button that
            would just 403. */}
        {hasFullAccess && <NewCourseDialog />}
      </div>
      <div className="mt-4">
        <AdminCoursesView courses={courses} />
      </div>
    </div>
  );
}
