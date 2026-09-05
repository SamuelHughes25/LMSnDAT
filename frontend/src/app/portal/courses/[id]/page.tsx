import Link from "next/link";
import { notFound } from "next/navigation";

import { CoursePreviewViewer, type PreviewSlide } from "@/components/course-preview/course-preview-viewer";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Course, CourseVersion } from "@/lib/course-types";
import type { Paginated } from "@/lib/types";

// The operative-facing "play" page — unlike the admin preview page (which
// falls back to a draft for the author's own convenience), this only ever
// shows the published version. If there isn't one, the course shouldn't
// have been reachable from the courses list (it renders as a disabled card
// there), so treat it the same as a missing course.
export default async function PortalCoursePlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let course: Course;
  try {
    course = await djangoFetch<Course>(`/courses/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  const versions = await djangoFetch<Paginated<CourseVersion>>(`/course-versions/?course=${id}`);
  const version = versions.results.find((v) => v.status === "published");

  if (!version) notFound();

  const slides: PreviewSlide[] = [...version.lessons]
    .sort((a, b) => a.order - b.order)
    .flatMap((lesson) =>
      [...lesson.slides]
        .sort((a, b) => a.order - b.order)
        .map((slide) => ({ slide, lessonTitle: lesson.title })),
    );

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/portal/courses" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to courses
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{course.name}</h1>
        </div>
      </div>

      {slides.length === 0 ? (
        <p className="text-sm text-muted-foreground">This course doesn&apos;t have any content yet.</p>
      ) : (
        <CoursePreviewViewer slides={slides} />
      )}
    </div>
  );
}
