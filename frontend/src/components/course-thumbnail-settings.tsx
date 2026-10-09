"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { updateCourseThumbnail } from "@/app/actions/courses";
import { CourseThumbnailPicker } from "@/components/course-thumbnail-picker";
import type { Course } from "@/lib/course-types";

// Its own card, separate from the deadline/assessment settings above it —
// same "one focused concern per card" convention this settings page already
// follows. Unlike those two (which stage local edits behind an explicit
// Save button), this uploads immediately on selection — the same "commit on
// selection" pattern the course builder's own image fields use — since
// there's no other field on this card a Save button would be batching it
// with anyway.
export function CourseThumbnailSettings({ course }: { course: Course }) {
  const [thumbnail, setThumbnail] = useState(course.thumbnail);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleChange(file: File | null) {
    setError(null);
    setPendingFile(file);
    setUploading(true);
    try {
      const updated = await updateCourseThumbnail(course.id, file);
      setThumbnail(updated.thumbnail);
      router.refresh();
    } catch {
      setError("Could not update the picture — try again.");
    } finally {
      setUploading(false);
      setPendingFile(null);
    }
  }

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 shadow-sm">
      <div className="font-medium">Picture</div>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">
        Shown on the portal&apos;s Normal course list view. Purely cosmetic — leaving this unset is fine.
      </p>
      <CourseThumbnailPicker
        value={pendingFile ?? thumbnail}
        onChange={handleChange}
        uploading={uploading}
        error={error}
      />
    </div>
  );
}
