"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { deleteCourse } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";

// Used only from the Courses list now (admin-courses-view.tsx) — the
// course's own Settings page used to have a second, labeled copy of this
// in its "Danger zone" card, redundant with the list's own trash icon
// plus the dedicated Archive page, so it was removed there.
export function DeleteCourseButton({ courseId, courseName }: { courseId: string; courseName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${courseName}`}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Archive "${courseName}"?`}
        // "Archive," not "delete" — this now hides the course from the
        // Courses list and everyone's portal, but keeps all its data/
        // attempts/analytics intact; see deleteCourse's own comment in
        // actions/courses.ts.
        description="It'll be hidden from the course list and the portal, but you can restore it anytime from the Archive section."
        confirmLabel="Archive"
        pendingLabel="Archiving…"
        action={() => deleteCourse(courseId)}
      />
    </>
  );
}
