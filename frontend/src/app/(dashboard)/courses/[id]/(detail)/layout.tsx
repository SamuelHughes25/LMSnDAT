import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CourseDetailNav } from "@/components/course-detail-nav";
import type { Course } from "@/lib/course-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";

// Scoped to courses/[id]/(detail)/* via the route group — (detail) never
// appears in the URL, and courses/[id]/builder/ sits outside this group so
// the full-screen builder does NOT get this sub-nav on top of its own rail
// and the app's global sidebar.
export default async function CourseDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let course: Course;
  try {
    course = await djangoFetch<Course>(`/courses/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    // h-full flex column (not the previous plain block div): gives the
    // content row below a genuine, bounded remaining height to hand to
    // `self-stretch` — most of the four tabs sharing this layout
    // (settings/members/activity/analytics) never needed that, they're
    // fine with their own natural height and `main`'s own overflow-y-auto
    // scrolling if they ever run long, same as before. The preview tab is
    // the one that needs a real ceiling to fit its canvas under instead of
    // pushing its own Next/Previous controls off-screen — see
    // course-preview-viewer.tsx's useStageScale.
    <div className="flex h-full flex-col">
      <Link
        href="/courses"
        className="mb-3 inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to courses
      </Link>

      <div className="mb-6 shrink-0">
        <h1 className="text-2xl font-semibold">{course.name}</h1>
        {course.description && <p className="mt-1 break-words text-muted-foreground">{course.description}</p>}
      </div>

      <div className="flex min-h-0 flex-1 items-start gap-6">
        <CourseDetailNav courseId={id} />
        {/* self-stretch (not items-start's default for this one child):
            gives {children} the row's full available height so a
            height-fitting tab (preview) has something real to measure,
            while CourseDetailNav next to it stays at the row's top,
            unaffected — align-self overrides the row's own items-start
            for just this one item. */}
        <div className="min-h-0 min-w-0 flex-1 self-stretch">{children}</div>
      </div>
    </div>
  );
}
