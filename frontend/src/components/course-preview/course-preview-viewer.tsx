"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { ActiveEditorProvider } from "@/components/course-builder/active-editor-context";
import { CANVAS_H, CANVAS_W } from "@/components/course-builder/slide-canvas";
import { SLIDE_TYPE_FACES } from "@/components/course-builder/slide-faces";
import { SlideBackgroundLayer } from "@/components/course-builder/slide-faces/background-image-field";
import { SlideSelectionProvider } from "@/components/course-builder/slide-selection-context";
import { Button } from "@/components/ui/button";
import type { Slide } from "@/lib/course-types";
import type { SlideInteractionResult } from "@/lib/slide-interaction";

export type PreviewSlide = { slide: Slide; lessonTitle: string };

// Read-only "slide through the deck" viewer — reuses the exact slide faces
// and canvas sizing the builder uses (CANVAS_W/CANVAS_H, SLIDE_TYPE_FACES)
// so a preview looks identical to the canvas, just non-interactive (except
// for interactive slide types' own "present" mode behavior — see
// onInteraction below).
export function CoursePreviewViewer({ slides }: { slides: PreviewSlide[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Accumulates each interactive slide's result as the learner answers it,
  // keyed by slide id (re-answering the same slide on a later visit — not
  // possible yet, since present-mode components are single-attempt, but a
  // future "try again" could exist — replaces rather than duplicates).
  // Local-only state, no backend call, no persistence — this is deliberately
  // the entire scope of "tracking" this pass; see
  // frontend/src/lib/slide-interaction.ts and docs/PROJECT_LOG.md for the
  // scope decision. A real learner-facing player, backed by a real
  // learner/assignment model, is what would actually persist these.
  const [results, setResults] = useState<Record<string, SlideInteractionResult>>({});

  const handleInteraction = useCallback((result: SlideInteractionResult) => {
    setResults((prev) => ({ ...prev, [result.slideId]: result }));
  }, []);

  const answeredCount = Object.keys(results).length;
  const correctCount = useMemo(
    () => Object.values(results).filter((r) => r.isCorrect).length,
    [results],
  );

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
    // PositionableBox (used by content-slide-face.tsx's title/subtitle/
    // body/body2 fields, in every mode including "present") calls BOTH
    // useSlideSelection() and useActiveEditorContext() unconditionally —
    // hooks, so they have to run on every render regardless of mode, even
    // though "present" mode's own early-return path never actually reads
    // either value. Both throw if their provider isn't anywhere above them
    // in the tree. course-builder.tsx already wraps its own tree in both
    // (ActiveEditorProvider from early on, SlideSelectionProvider added
    // later for the "resize dots get stuck" fix), but this viewer is a
    // genuinely separate top-level component tree — its own route/page,
    // never nested inside course-builder.tsx — so it never inherited
    // either. Confirmed via a real browser: previewing ANY course
    // containing a "content" slide 500'd the whole page — first on the
    // missing SlideSelectionProvider, and (after fixing just that) again
    // immediately on the missing ActiveEditorProvider — which is why
    // "can't preview" reads as a near-total preview outage, not a niche
    // edge case: content slides are the most common type by far. Same
    // nesting order as course-builder.tsx, for no particular reason beyond
    // consistency — the two providers don't interact.
    <ActiveEditorProvider>
      <SlideSelectionProvider>
        <div className="flex flex-col items-center">
          <div className="mb-2 text-sm text-muted-foreground">{current.lessonTitle}</div>

          <div className="flex items-center justify-center overflow-auto rounded-lg bg-muted p-8">
            <div
              className="relative shrink-0 overflow-hidden rounded-sm bg-white shadow-lg"
              style={{ width: CANVAS_W, height: CANVAS_H }}
            >
              <SlideBackgroundLayer
                value={current.slide.config.background_image_url}
                mode="present"
                xPct={current.slide.config.background_image_x_pct}
                yPct={current.slide.config.background_image_y_pct}
                widthPct={current.slide.config.background_image_width_pct}
                heightPct={current.slide.config.background_image_height_pct}
              />
              <div className="relative z-10 h-full w-full">
                <Face key={current.slide.id} slide={current.slide} mode="present" onInteraction={handleInteraction} />
              </div>
            </div>
          </div>

          {/* Running tally, not a full end-of-deck summary screen — shows once
              at least one interactive slide has been answered. Later stages
              (Missing Word, Match the Pair) need no changes here: they report
              through the same onInteraction/results shape. */}
          {answeredCount > 0 && (
            <div className="mt-2 text-sm text-muted-foreground">
              Score so far: {correctCount}/{answeredCount}
            </div>
          )}

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
      </SlideSelectionProvider>
    </ActiveEditorProvider>
  );
}
