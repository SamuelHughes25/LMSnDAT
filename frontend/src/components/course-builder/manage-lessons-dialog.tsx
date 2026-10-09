"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

import { deleteReusableLesson, listReusableLessons } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReusableLesson } from "@/lib/course-types";

// The one dialog that covers "add/manage/view" saved reusable lessons —
// entries can only be CREATED via save-lesson-dialog.tsx (cloning an
// existing authored lesson's slides), not from here; this only manages
// what already exists in the library: view it, import a copy into the
// current course's draft, or delete it permanently. Controlled, no
// DialogTrigger of its own — opened from a button in slide-rail.tsx next
// to "Add lesson".
export function ManageLessonsDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (reusableLessonId: string) => Promise<void>;
}) {
  const [lessons, setLessons] = useState<ReusableLesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Refetches every time the dialog opens — the library can change between
  // opens (a lesson saved from elsewhere in this same session, or one
  // deleted here last time) and a Client Component like this one has no
  // Server Component refetch to piggyback on.
  useEffect(() => {
    if (!open) return;
    listReusableLessons()
      .then((data) => {
        setLessons(data);
        setError(null);
      })
      .catch(() => setError("Could not load the reusable lesson library."));
  }, [open]);

  async function handleImport(id: string) {
    setPendingId(id);
    setError(null);
    try {
      await onImport(id);
      onOpenChange(false);
    } catch {
      setError("Could not import this lesson. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(id: string) {
    setPendingId(id);
    setError(null);
    try {
      await deleteReusableLesson(id);
      setLessons((prev) => prev?.filter((l) => l.id !== id) ?? prev);
    } catch {
      setError("Could not delete this lesson. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reusable lessons</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Import a saved lesson into this course, or remove one you no longer need. Save a new one from any
          lesson&apos;s own menu.
        </p>

        <div className="max-h-96 space-y-2 overflow-y-auto">
          {lessons === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
          {lessons?.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing saved yet — save a lesson to get started.</p>
          )}
          {lessons?.map((lesson) => (
            <div
              key={lesson.id}
              className="flex items-center gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{lesson.name}</div>
                {lesson.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{lesson.description}</p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {lesson.slide_count} slide{lesson.slide_count === 1 ? "" : "s"} · saved{" "}
                  {new Date(lesson.created_at).toLocaleDateString()}
                </p>
              </div>
              <Button
                size="sm"
                disabled={pendingId === lesson.id}
                onClick={() => handleImport(lesson.id)}
              >
                {pendingId === lesson.id ? "Importing…" : "Import"}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={pendingId === lesson.id}
                onClick={() => handleDelete(lesson.id)}
                aria-label={`Delete ${lesson.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
