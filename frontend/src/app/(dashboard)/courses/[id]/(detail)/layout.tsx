import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { CourseDetailNav } from "@/components/course-detail-nav";
import type { Course } from "@/lib/course-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import { canEditOwnedContent } from "@/lib/role-access";

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

  // The one gate shared by every sub-page under here (Overview/Preview/
  // Analytics had none of their own — the fork's audit flagged exactly
  // this gap). Members/Groups/Settings/Version-history each additionally
  // check their own finer-grained viewer_can_edit_* flag on top of this,
  // but every one of those already implies passing this coarser check too
  // (see canEditOwnedContent's own comment), so there's no case where this
  // blocks someone who'd pass one of those stricter gates further in.
  if (!(await canEditOwnedContent(course, "courses"))) {
    return <AccessDenied message="You don't have permission to manage this course." />;
  }

  return (
    // h-full flex column (not the previous plain block div): gives the
    // content row below a genuine, bounded remaining height to hand to
    // `self-stretch` — most of the four tabs sharing this layout
    // (settings/members/version-history/analytics) never needed that, they're
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
        <CourseDetailNav
          courseId={id}
          canEditMembers={course.viewer_can_edit_members}
          canEditGroups={course.viewer_can_edit_groups}
          canEditSettings={course.viewer_can_edit_settings}
          canViewVersionHistory={course.viewer_can_view_version_history}
        />
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
