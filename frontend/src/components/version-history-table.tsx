"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, History } from "lucide-react";

import { revertToVersion } from "@/app/actions/courses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CoursePreviewViewer, type PreviewSlide } from "@/components/course-preview/course-preview-viewer";
import type { CourseVersion } from "@/lib/course-types";
import { cn } from "@/lib/utils";

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

// Same flatten-lessons-into-slides shape as preview/page.tsx — built here
// instead of re-fetched, since `versions` already arrives with every
// lesson/slide nested (the same /course-versions/ response this page's own
// server component already fetched).
function slidesFor(version: CourseVersion): PreviewSlide[] {
  return [...version.lessons]
    .sort((a, b) => a.order - b.order)
    .flatMap((lesson) =>
      [...lesson.slides]
        .sort((a, b) => a.order - b.order)
        .map((slide) => ({ slide, lessonTitle: lesson.title })),
    );
}

function RevertButton({
  courseId,
  version,
  disabled,
}: {
  courseId: string;
  version: CourseVersion;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? "This course already has an unpublished draft — finish or delete it first." : undefined}
      >
        <History className="mr-1 h-3.5 w-3.5" />
        Revert to this version
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Revert to version ${version.version_number}?`}
        description={
          <>
            This starts a <strong>new, unpublished draft</strong> in the builder, cloned from version{" "}
            {version.version_number}&apos;s own lessons and slides — it won&apos;t be published automatically, so
            you can keep tweaking it first. The currently published version (if any) stays live and untouched
            until you publish this new draft yourself.
          </>
        }
        confirmLabel="Start new draft"
        pendingLabel="Starting draft…"
        action={() => revertToVersion(courseId, version.id)}
        // Not the default router.refresh() — a successful revert means
        // there's now a real draft to edit, so this goes straight to the
        // builder instead of leaving the viewer sitting on this read-only
        // table looking at what they just created.
        onSuccess={() => router.push(`/courses/${courseId}/builder`)}
      />
    </>
  );
}

// Client component: owns which version row is expanded, and renders the
// expanded row's mini read-only preview (CoursePreviewViewer, no
// attemptTracking — identical "just look at it" mode the admin Preview tab
// already uses) plus the revert action. The surrounding page.tsx (a Server
// Component) only fetches and filters the version list.
export function VersionHistoryTable({
  courseId,
  versions,
  hasDraft,
}: {
  courseId: string;
  versions: CourseVersion[];
  hasDraft: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="rounded-lg border-2 border-border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Published by</TableHead>
            <TableHead>Published</TableHead>
            <TableHead>Details</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {versions.map((version) => {
            const isOpen = expandedId === version.id;
            const slides = isOpen ? slidesFor(version) : [];
            return (
              <Fragment key={version.id}>
                <TableRow>
                  <TableCell className="font-medium">v{version.version_number}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[version.status]} className="capitalize">
                      {version.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{version.created_by_username}</TableCell>
                  <TableCell>{version.published_at ? formatDateTime(version.published_at) : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {version.lessons.length} lesson{version.lessons.length === 1 ? "" : "s"},{" "}
                    {version.assets.length} asset{version.assets.length === 1 ? "" : "s"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={isOpen ? `Hide version ${version.version_number}'s preview` : `Preview version ${version.version_number}`}
                      aria-expanded={isOpen}
                      onClick={() => setExpandedId(isOpen ? null : version.id)}
                    >
                      <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                    </Button>
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableCell colSpan={6} className="py-3">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground">
                            Version {version.version_number} preview
                          </span>
                          <RevertButton courseId={courseId} version={version} disabled={hasDraft} />
                        </div>
                        {slides.length === 0 ? (
                          <p className="text-sm text-muted-foreground">This version has no slides.</p>
                        ) : (
                          // Fixed height — CoursePreviewViewer sizes its own
                          // canvas via a ResizeObserver on this container
                          // (see useStageScale in that component), so it
                          // needs a real pixel height to measure, not just
                          // percentage heights all the way up through a
                          // table cell that has none of its own.
                          <div className="h-[380px] rounded-lg border border-border bg-background p-2">
                            <CoursePreviewViewer slides={slides} maxWidthClassName="max-w-2xl" />
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
          {versions.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No published versions yet — publish a draft from the builder to start this course&apos;s version
                history.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
