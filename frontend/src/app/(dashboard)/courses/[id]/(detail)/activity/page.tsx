import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CourseVersion } from "@/lib/course-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

const STATUS_VARIANT: Record<CourseVersion["status"], "default" | "secondary" | "outline"> = {
  draft: "secondary",
  published: "default",
  archived: "outline",
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// A simple version-history table — every CourseVersion this course has ever
// had (draft, published, and archived-by-a-later-publish), newest first.
// Deliberately read-only/informational, unlike the Members/Groups tabs:
// there's nothing to add or remove here, just a record of what happened.
export default async function CourseActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // page_size=200 — this tab's whole purpose is a full historical record,
  // so the default 25-row page (see DefaultPagination) would be exactly
  // backwards here: it'd silently hide a course's OLDEST versions instead
  // of its least relevant ones. See builder/page.tsx's identical fetch for
  // the same reasoning applied to its own, narrower need.
  const versions = await djangoFetch<Paginated<CourseVersion>>(`/course-versions/?course=${id}&page_size=200`);
  const sorted = [...versions.results].sort((a, b) => b.version_number - a.version_number);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="mt-1 text-muted-foreground">Version history for this course.</p>
      </div>

      <div className="rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Changed by</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last updated</TableHead>
              <TableHead>Published</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((version) => (
              <TableRow key={version.id}>
                <TableCell className="font-medium">v{version.version_number}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[version.status]} className="capitalize">
                    {version.status}
                  </Badge>
                </TableCell>
                <TableCell>{version.created_by_username}</TableCell>
                <TableCell>{formatDateTime(version.created_at)}</TableCell>
                <TableCell>{formatDateTime(version.updated_at)}</TableCell>
                <TableCell>
                  {version.published_at ? (
                    formatDateTime(version.published_at)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {version.lessons.length} lesson{version.lessons.length === 1 ? "" : "s"},{" "}
                  {version.assets.length} asset{version.assets.length === 1 ? "" : "s"}
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No versions yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
