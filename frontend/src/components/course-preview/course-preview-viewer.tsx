"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { CANVAS_H, CANVAS_W } from "@/components/course-builder/slide-canvas";
import { SLIDE_TYPE_FACES } from "@/components/course-builder/slide-faces";
import { Button } from "@/components/ui/button";
import type { Slide } from "@/lib/course-types";

export type PreviewSlide = { slide: Slide; lessonTitle: string };

// Read-only "slide through the deck" viewer — reuses the exact slide faces
// and canvas sizing the builder uses (CANVAS_W/CANVAS_H, SLIDE_TYPE_FACES)
// so a preview looks identical to the canvas, just non-interactive.
export function CoursePreviewViewer({ slides }: { slides: PreviewSlide[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Defensive clamp: page.tsx already routes an empty deck to its own
  // empty state before this component ever mounts, but this keeps the
  // component itself crash-safe (no slides[0] on an empty/shrunk array)
  // rather than relying solely on the caller never passing [].
  const clampedIndex = slides.length === 0 ? 0 : Math.min(currentIndex, slides.length - 1);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setCurrentIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setCurrentIndex((i) => Math.min(slides.length - 1, i + 1));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [slides.length]);

  if (slides.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border-2 border-border bg-card p-6 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">No content yet — open the builder to add slides.</p>
      </div>
    );
  }

  const current = slides[clampedIndex];
  const Face = SLIDE_TYPE_FACES[current.slide.slide_type];

  return (
    <div className="flex flex-col items-center">
      <div className="mb-2 text-sm text-muted-foreground">{current.lessonTitle}</div>

      <div className="flex items-center justify-center overflow-auto rounded-lg bg-muted p-8">
        <div
          className="shrink-0 overflow-hidden rounded-sm bg-white shadow-lg"
          style={{ width: CANVAS_W, height: CANVAS_H }}
        >
          <Face key={current.slide.id} slide={current.slide} interactive={false} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          disabled={clampedIndex === 0}
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Slide {clampedIndex + 1} of {slides.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={clampedIndex === slides.length - 1}
          onClick={() => setCurrentIndex((i) => Math.min(slides.length - 1, i + 1))}
        >
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
