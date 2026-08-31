import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateCourseDraftButton } from "@/components/create-course-draft-button";
import { PublishCourseButton } from "@/components/publish-course-button";
import type { CourseVersion } from "@/lib/course-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

const STATUS_VARIANT: Record<CourseVersion["status"], "default" | "secondary" | "outline"> = {
  draft: "secondary",
  published: "default",
  archived: "outline",
};

// Course existence/404 is already handled by the (detail) layout, which
// fetches the course itself — this page only needs the version list.
export default async function CourseOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const versions = await djangoFetch<Paginated<CourseVersion>>(`/course-versions/?course=${id}`);
  const sorted = [...versions.results].sort((a, b) => b.version_number - a.version_number);
  const draft = sorted.find((v) => v.status === "draft");
  const published = sorted.find((v) => v.status === "published");

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between rounded-lg border-2 border-border bg-card p-4 shadow-sm">
        <div>
          <div className="font-medium">Draft</div>
          <div className="text-sm text-muted-foreground">
            {draft ? `Version ${draft.version_number}` : "No draft in progress."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {draft ? (
            <>
              <Button variant="outline" size="sm" render={<Link href={`/courses/${id}/builder`} />}>
                Open builder
              </Button>
              <PublishCourseButton courseId={id} versionId={draft.id} />
            </>
          ) : (
            <CreateCourseDraftButton courseId={id} />
          )}
        </div>
      </div>

      <div className="rounded-lg border-2 border-border bg-card p-4 shadow-sm">
        <div className="font-medium">Published</div>
        <div className="text-sm text-muted-foreground">
          {published
            ? `Version ${published.version_number}${published.published_at ? ` · published ${new Date(published.published_at).toLocaleDateString()}` : ""}`
            : "Not published yet."}
        </div>
      </div>

      {sorted.length > 0 && (
        <div>
          <div className="mb-2 font-medium">All versions</div>
          <ul className="space-y-1.5">
            {sorted.map((version) => (
              <li key={version.id} className="flex items-center gap-2 text-sm">
                <span>v{version.version_number}</span>
                <Badge variant={STATUS_VARIANT[version.status]}>{version.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
