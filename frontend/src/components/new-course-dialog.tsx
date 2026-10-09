"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createCourse } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";
import { CourseThumbnailPicker } from "@/components/course-thumbnail-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Mirrors the backend's own cap (Course.description's max_length — see
// apps/courses/models.py) — enforced there too, so this is a client-side
// convenience (immediate feedback, no round-trip needed to find out a
// description is too long), never the only thing standing between a
// learner and an oversized value.
const DESCRIPTION_MAX_LENGTH = 300;

export function NewCourseDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Staged here, not uploaded until the form actually submits — there's no
  // course id yet for a thumbnail to attach to (see createCourse, which
  // sends this in the same multipart request as name/description).
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const course = await createCourse(name.trim(), description.trim(), thumbnail);
        setOpen(false);
        setName("");
        setDescription("");
        setThumbnail(null);
        router.push(`/courses/${course.id}`);
      } catch {
        setError("Could not create course. Please try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>New course</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New course</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Picture</Label>
            <CourseThumbnailPicker value={thumbnail} onChange={setThumbnail} disabled={pending} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="description">Description</Label>
              <span className="text-xs text-muted-foreground">
                {description.length}/{DESCRIPTION_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESCRIPTION_MAX_LENGTH}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
