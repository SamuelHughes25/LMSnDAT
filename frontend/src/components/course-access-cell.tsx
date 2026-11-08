"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { addCourseAssignment, removeCourseAssignment } from "@/app/actions/courses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";

// One cell in the course Members tab's "Direct assignment" column — add/
// remove a direct User<->Course link, independent of Group membership (see
// CourseAssignment's own comment in course-types.ts). Deliberately simpler
// than user-groups-editor.tsx's multi-select-style editor: this page's own
// search bar already IS the "pick a user" step, so each row only ever
// needs one action (add or remove), not a dropdown of candidates.
//
// `assignmentId` is null when this user has no direct assignment for this
// course yet — note this is checked WITHOUT regard to whether the user
// already has the course via a Group: that's a deliberately separate,
// non-conflicting signal shown in its own Groups column, never cross-
// checked against this one (see the page's own comment on why).
export function CourseAccessCell({
  courseId,
  userId,
  assignmentId,
  canEdit = true,
}: {
  courseId: string;
  userId: number;
  assignmentId: string | null;
  // See CourseSerializer.viewer_can_edit_members — an owner always has
  // this; a plain editor needs the matching PermissionSet sub-permission.
  // Without it this cell is read-only (a plain "Assigned" badge, no X, or
  // nothing at all), not hidden entirely — there's still something worth
  // showing, just nothing to click.
  canEdit?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleAdd() {
    startTransition(async () => {
      const result = await addCourseAssignment(courseId, userId);
      if (!result.ok) {
        // A toast, not inline text in this cell — an error here (e.g.
        // "they're already in the X group") could be a full sentence, and
        // showing it inline stretched/misaligned this column's own row
        // height against every other column, reported directly as
        // looking messy. Still refresh on failure, not just success: the
        // most likely way this ever actually fails is a duplicate-
        // assignment race (two admins, or one double-click outrunning the
        // pending-disabled state) — the row IS assigned by now, just not
        // by this click, so refreshing self-heals this button from stale
        // "Add" to "Assigned" instead of leaving it clickable into the
        // same error forever.
        toastManager.add({ title: "Couldn't assign this course", description: result.error, type: "error" });
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  function handleRemove() {
    if (!assignmentId) return;
    const id = assignmentId;
    startTransition(async () => {
      const result = await removeCourseAssignment(id, courseId);
      if (!result.ok) {
        toastManager.add({ title: "Couldn't remove this assignment", description: result.error, type: "error" });
        return;
      }
      router.refresh();
    });
  }

  if (!canEdit) {
    return assignmentId ? (
      <Badge variant="secondary">Assigned</Badge>
    ) : (
      <span className="text-sm text-muted-foreground">—</span>
    );
  }

  return assignmentId ? (
    <Badge variant="secondary" className="gap-1 py-1 pr-1">
      Assigned
      <button
        type="button"
        onClick={handleRemove}
        disabled={pending}
        aria-label="Remove direct assignment"
        className="rounded-full p-0.5 hover:bg-muted-foreground/20"
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  ) : (
    <Button type="button" size="xs" variant="outline" onClick={handleAdd} disabled={pending}>
      {pending ? "Adding…" : "Add"}
    </Button>
  );
}
