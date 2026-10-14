"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { deleteCourseDraft } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";

// Sits next to "Open builder" on the course overview page — lets the
// author back out of a draft entirely (start over from the published
// version, or just abandon unpublished changes) without having to open
// the builder and delete every slide/lesson by hand. Permanent and
// irreversible (see deleteCourseDraft's own comment on why this is a
// hard delete, not an archive/restore pair like whole-course deletion
// gets) — hence the destructive confirm dialog, same pattern as every
// other permanent-delete action in this app.
export function DeleteCourseDraftButton({
  courseId,
  versionId,
  versionNumber,
}: {
  courseId: string;
  versionId: string;
  versionNumber: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label="Delete this draft"
        title="Delete this draft"
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete draft version ${versionNumber}?`}
        description="This permanently deletes every lesson and slide in this draft. It cannot be undone, and the published version (if any) is unaffected — you can start a fresh draft from it afterward."
        confirmLabel="Delete draft"
        pendingLabel="Deleting…"
        destructive
        action={() => deleteCourseDraft(courseId, versionId)}
      />
    </>
  );
}
