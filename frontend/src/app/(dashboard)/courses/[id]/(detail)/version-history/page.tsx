import { VersionHistoryTable } from "@/components/version-history-table";
import type { CourseVersion } from "@/lib/course-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// page_size=200 — this tab's whole purpose is a full historical record, so
// the default 25-row page (see DefaultPagination) would be exactly
// backwards here: it'd silently hide a course's OLDEST versions instead of
// its least relevant ones. See builder/page.tsx's identical fetch for the
// same reasoning applied to its own, narrower need.
export default async function CourseVersionHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const versions = await djangoFetch<Paginated<CourseVersion>>(`/course-versions/?course=${id}&page_size=200`);

  // Only versions that have actually been published at some point, past or
  // present — a never-published draft isn't "history" yet, it's the thing
  // currently being worked on (visible instead from Overview/Preview/the
  // builder). publish_version (backend/apps/courses/services.py) archives
  // the PREVIOUS published version rather than deleting it, so this
  // correctly includes every superseded version too, not just the one
  // currently live — status alone can't tell them apart (only ever one row
  // has status='published' at a time), published_at can.
  const published: CourseVersion[] = versions.results
    .filter((v) => v.published_at !== null)
    .sort((a, b) => b.version_number - a.version_number);

  const hasDraft = versions.results.some((v) => v.status === "draft");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Version history</h1>
        <p className="mt-1 text-muted-foreground">
          Every version of this course that&apos;s ever been published. Open one to see what it looked like, or
          revert to it to start a new draft from its content.
        </p>
      </div>

      <VersionHistoryTable courseId={id} versions={published} hasDraft={hasDraft} />
    </div>
  );
}
