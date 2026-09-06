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
    // No max-w cap here (unlike the other portal pages) — CoursePreviewViewer
    // already caps its own stage (via maxWidthClassName below) and centers
    // itself; capping this ancestor too, at a NARROWER width than the
    // stage's fixed 960px canvas, is exactly what previously made the canvas
    // overflow this column and visually bleed into the sidebar. See the
    // fix's commit message for the full "960 > 896" arithmetic. The sidebar
    // itself also auto-collapses on this route (see portal-shell.tsx's
    // COURSE_PLAYER_PATH) so this column gets the extra width to grow into
    // in the first place.
    //
    // h-full flex column (not the previous plain space-y-3 block): gives
    // the viewer below a genuine, bounded remaining height (total height
    // minus this header row's own natural height) to fit itself into,
    // instead of the canvas dictating its own height from width alone and
    // pushing the Previous/Next controls below the fold — confirmed in a
    // real browser to require a page scroll before this fix.
    <div className="flex h-full flex-col gap-3">
      {/* Back link and title share one row (previously stacked, the title
          on its own line below) purely to reclaim vertical space for this
          page's much larger, presentation-style player — every pixel here
          is a pixel the canvas below doesn't get. */}
      <div className="flex shrink-0 items-center gap-3">
        <Link
          href="/portal/courses"
          className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to courses
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <h1 className="truncate text-base font-semibold">{course.name}</h1>
      </div>

      {slides.length === 0 ? (
        <p className="text-sm text-muted-foreground">This course doesn&apos;t have any content yet.</p>
      ) : (
        <div className="min-h-0 flex-1">
          <CoursePreviewViewer slides={slides} maxWidthClassName="max-w-[1600px]" />
        </div>
      )}
    </div>
  );
}
