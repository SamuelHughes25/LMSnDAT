import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/access-denied";
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

  // Used to be a soft gate — show the real settings, just visually
  // disabled ("you can view, but can't change") — on the reasoning that
  // the backend (CanManageCourseSettings) was the real enforcement anyway.
  // Changed to match the hard "one on/off switch, full capability or
  // nothing" gate every other course sub-permission now uses (Members/
  // Groups — see their own page.tsx comments), and the nav link itself is
  // now hidden the same way (course-detail-nav.tsx): nobody with a
  // legitimate reason to merely READ deadline/assessment/thumbnail config
  // without editing it was ever identified, so there's no real "view-only"
  // tier worth preserving here either.
  if (!course.viewer_can_edit_settings) {
    return <AccessDenied message="You don't have permission to manage this course's settings." />;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <CourseThumbnailSettings course={course} />
      <CourseAssessmentSettings course={course} />
      <CourseDeadlineSettings course={course} />
    </div>
  );
}
