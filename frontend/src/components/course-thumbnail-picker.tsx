"use client";

import { useEffect, useMemo, useRef } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A deliberately much simpler sibling of the course builder's own
// image-field.tsx/background-image-field.tsx pickers — same "paste
// (Ctrl+V) or browse" dropzone feel, but with no resize handles or
// xPct/yPct positioning (a course thumbnail is always shown at a fixed
// size/crop by its caller) and no CourseAsset/courseVersionId coupling —
// a thumbnail is a plain field on Course itself, settable before any
// CourseVersion exists (new-course-dialog.tsx) or long after
// (course-thumbnail-settings.tsx). Callers own the actual upload: this
// component only ever hands back a raw File (or null for "remove"); it
// never calls a server action itself, so it works identically whether the
// caller stages the file for a later multipart submit (create) or uploads
// it immediately on selection (edit).
export function CourseThumbnailPicker({
  value,
  onChange,
  uploading = false,
  error = null,
  disabled = false,
  className,
}: {
  // A string is an already-uploaded picture's URL; a File is one just
  // picked/pasted but not yet (or not necessarily) uploaded; null is "no
  // picture set."
  value: File | string | null;
  onChange: (file: File | null) => void;
  uploading?: boolean;
  error?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Derived, not stored in state — a fresh object URL is created during
  // render whenever `value` changes to a new File (useMemo keyed on
  // `value`), never via setState in an effect. The effect below only
  // revokes it, exactly the "synchronize with an external system" case
  // useEffect is meant for — it never itself calls setState.
  const objectUrl = useMemo(() => (value instanceof File ? URL.createObjectURL(value) : null), [value]);

  // Object URLs must be revoked once no longer displayed, or each new
  // selection leaks the previous one's memory for the lifetime of the tab.
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const previewUrl = value instanceof File ? objectUrl : value;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the same file again (e.g. after Replace) still fires
    // a change event.
    e.target.value = "";
    if (file) onChange(file);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) onChange(file);
  }

  return (
    <div
      tabIndex={0}
      onPaste={handlePaste}
      className={cn(
        "group relative flex h-32 w-56 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-border outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        !previewUrl && "bg-muted",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled}
      />

      {previewUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- an
              uploaded/staged picture, not a static/known-domain import
              next/image can optimize. */}
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || disabled}
            >
              Replace
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onChange(null)}
              disabled={uploading || disabled}
              aria-label="Remove picture"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 text-muted-foreground/60">
          {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
          <div className="px-3 text-center text-xs">
            {uploading ? (
              "Uploading…"
            ) : (
              <>
                Paste an image (Ctrl+V), or{" "}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                  disabled={disabled}
                  className="underline underline-offset-2 hover:text-foreground disabled:cursor-not-allowed"
                >
                  browse files
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="absolute right-1 bottom-1 left-1 rounded bg-destructive/90 px-2 py-1 text-center text-xs text-white">
          {error}
        </div>
      )}
    </div>
  );
}
