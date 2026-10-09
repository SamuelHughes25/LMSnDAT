import Link from "next/link";

import { CoursePreviewViewer, type PreviewSlide } from "@/components/course-preview/course-preview-viewer";
import type { CourseVersion } from "@/lib/course-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// Course existence/404 is already handled by the (detail) layout, which
// fetches the course itself — this page only needs the version list.
export default async function CoursePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // page_size=200 — see builder/page.tsx's identical fetch for why.
  const versions = await djangoFetch<Paginated<CourseVersion>>(`/course-versions/?course=${id}&page_size=200`);
  const sorted = [...versions.results].sort((a, b) => b.version_number - a.version_number);
  const version = sorted.find((v) => v.status === "published") ?? sorted.find((v) => v.status === "draft");

  if (!version) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-6 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">No content yet — open the builder to add slides.</p>
        <Link href={`/courses/${id}/builder`} className="mt-2 text-sm font-medium text-primary hover:underline">
          Open builder
        </Link>
      </div>
    );
  }

  // Flatten lessons[].slides[] into one ordered array (lessons by order,
  // slides within each lesson by order), carrying the parent lesson's title
  // along for the viewer's caption.
  const slides: PreviewSlide[] = [...version.lessons]
    .sort((a, b) => a.order - b.order)
    .flatMap((lesson) =>
      [...lesson.slides]
        .sort((a, b) => a.order - b.order)
        .map((slide) => ({ slide, lessonTitle: lesson.title })),
    );

  if (slides.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-6 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">No content yet — open the builder to add slides.</p>
        <Link href={`/courses/${id}/builder`} className="mt-2 text-sm font-medium text-primary hover:underline">
          Open builder
        </Link>
      </div>
    );
  }

  return <CoursePreviewViewer slides={slides} />;
}
