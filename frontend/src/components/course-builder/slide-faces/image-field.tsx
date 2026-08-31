"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

import { uploadCourseAsset } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SlideFaceProps } from "./index";

export function EditableImage({
  value,
  mode,
  courseVersionId,
  onCommit,
  className,
}: {
  value: string | null | undefined;
  mode: SlideFaceProps["mode"];
  courseVersionId: string | undefined;
  onCommit: (value: string | null) => void;
  className?: string;
}) {
  if (mode === "edit") {
    return (
      <ImageUploadField
        value={value}
        courseVersionId={courseVersionId}
        onCommit={onCommit}
        className={className}
      />
    );
  }
  return <ImageStatic value={value} className={className} />;
}

// Uploads through uploadCourseAsset (a Server Action, called imperatively —
// no <form> needed) directly to Django's existing /course-assets/ endpoint,
// which was built alongside the courses backend but never had a frontend
// caller until now. On success, config.image_url is set to the returned
// asset's file URL — see the comment on SlideConfig.image_url in
// course-types.ts for why this stores the URL directly rather than an
// asset id.
//
// Known limitation, not solved here: in this dev setup Django's file URL is
// directly reachable by the browser (both run on localhost), but the app's
// documented BFF architecture (see docs/PROJECT_LOG.md) makes Django
// internal-only in production — an image URL built from an internal-only
// request wouldn't resolve for a real learner's browser. Serving uploaded
// images through a public path (a Next.js proxy route, or switching
// production storage to a public/presigned S3-compatible URL — the
// STORAGE_BACKEND=s3 config already exists for exactly this) is a real but
// separate piece of work, flagged here rather than silently assumed solved.
function ImageUploadField({
  value,
  courseVersionId,
  onCommit,
  className,
}: {
  value: string | null | undefined;
  courseVersionId: string | undefined;
  onCommit: (value: string | null) => void;
  className?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input's value so selecting the same file again (e.g. after
    // Replace) still fires a change event.
    e.target.value = "";
    if (!file || !courseVersionId) return;

    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("course_version", courseVersionId);
      formData.append("kind", "image");
      formData.append("file", file);
      const asset = await uploadCourseAsset(formData);
      onCommit(asset.file);
    } catch {
      setError("Upload failed — try a different image.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className={cn(
        "group relative flex h-full w-full items-center justify-center overflow-hidden rounded-md bg-muted",
        className,
      )}
    >
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

      {value ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- uploaded
              asset URL isn't a static/known-domain import next/image can
              optimize, and these are admin-authored training images, not a
              case that needs automatic optimization. */}
          <img src={value} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              Replace
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onCommit(null)}
              disabled={uploading}
              aria-label="Remove image"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || !courseVersionId}
          className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground/60 transition-colors hover:text-muted-foreground disabled:cursor-not-allowed"
        >
          {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
          <span className="text-sm">{uploading ? "Uploading…" : "Click to add image"}</span>
        </button>
      )}

      {error && (
        <div className="absolute right-1 bottom-1 left-1 rounded bg-destructive/90 px-2 py-1 text-center text-xs text-white">
          {error}
        </div>
      )}
    </div>
  );
}

// Thumbnails/preview never mount upload machinery at all — a plain <img>
// (or an empty muted box if no image has been set yet), same "must never
// mount anything interactive/expensive" rule already applied to every other
// slide type's static render.
function ImageStatic({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) {
    return <div className={cn("h-full w-full rounded-md bg-muted", className)} />;
  }
  return (
    // See the note on ImageUploadField above for why a plain <img> is used.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={value} alt="" className={cn("h-full w-full rounded-md object-cover", className)} />
  );
}
