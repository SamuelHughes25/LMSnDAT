"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Lesson } from "@/lib/course-types";

// Controlled, no DialogTrigger of its own — the trigger is a small icon
// button inside slide-rail.tsx's LessonSection header row (next to the
// existing delete button), which just flips `open`; Base UI's Dialog
// renders through a portal regardless of where this component sits in the
// tree. Saving clones `lesson`'s current slides into a brand-new
// ReusableLesson library entry (see backend's ReusableLesson model and
// services.save_lesson_as_reusable) — a one-time snapshot, not a live
// link, so later edits to this lesson never change the saved copy.
export function SaveLessonDialog({
  lesson,
  open,
  onOpenChange,
  onSave,
}: {
  lesson: Lesson;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState(lesson.title);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // `open` flips from false to true via the PARENT's own state (the icon
  // button in slide-rail.tsx sets it directly) — Base UI's onOpenChange
  // only fires for the dialog's OWN internal close events (Escape, backdrop
  // click), never for that external open, so resetting the form there (as
  // an earlier version of this component did) silently never ran. Instead,
  // reset during render by noticing `open` changed — this project's
  // sanctioned alternative to setState-in-an-effect for "reset this state
  // when a prop changes" (see app-shell.tsx's own use of the same
  // pattern for its course-player route reset).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      // Reset to the lesson's current title each time the dialog opens —
      // it may have been renamed since the last time this was open.
      setName(lesson.title);
      setDescription("");
      setError(null);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onSave(name.trim(), description.trim());
        onOpenChange(false);
      } catch {
        setError("Could not save this lesson. Please try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as reusable lesson</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Saves a copy of this lesson&apos;s slides to your reusable lesson library, so it can be imported into
          other courses. Editing this lesson afterward won&apos;t change the saved copy.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reusable-lesson-name">Name</Label>
            <Input id="reusable-lesson-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reusable-lesson-description">Description</Label>
            <Textarea
              id="reusable-lesson-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — helps you find it later in the library."
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
