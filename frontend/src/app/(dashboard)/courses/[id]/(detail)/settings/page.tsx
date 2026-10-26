import { notFound } from "next/navigation";

import { CourseAssessmentSettings } from "@/components/course-assessment-settings";
import { CourseDeadlineSettings } from "@/components/course-deadline-settings";
import { CourseThumbnailSettings } from "@/components/course-thumbnail-settings";
import type { Course } from "@/lib/course-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";

export default async function CourseSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The layout already fetched this course once, but Server Components
  // don't share fetch results across files without a shared cache() helper
  // (see lib/dal.ts for that pattern elsewhere) — a second no-store fetch
  // here is the simplest correct option, and it's cheap.
  let course: Course;
  try {
    course = await djangoFetch<Course>(`/courses/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div className="max-w-2xl space-y-6">
      {!course.viewer_can_edit_settings && (
        <p className="rounded-lg border-2 border-border bg-card p-3 text-sm text-muted-foreground shadow-sm">
          You can view this course&apos;s settings, but don&apos;t have permission to change them.
        </p>
      )}
      {/* A page-level wrapper rather than threading a `canEdit` prop into
          each of these three — they each have their own mix of inputs/
          toggles/file upload, and disabling the whole region visually
          (plus pointer-events-none, so nothing inside is even clickable)
          is both simpler and safer than relying on every sub-component to
          individually remember to disable every one of its own controls.
          The backend (CanManageCourseSettings) is the real enforcement
          either way — this is purely so a viewer without the permission
          isn't shown live-looking controls that would just 403. */}
      <div className={!course.viewer_can_edit_settings ? "pointer-events-none space-y-6 opacity-60" : "space-y-6"}>
        <CourseThumbnailSettings course={course} />
        <CourseAssessmentSettings course={course} />
        <CourseDeadlineSettings course={course} />
      </div>
    </div>
  );
}
