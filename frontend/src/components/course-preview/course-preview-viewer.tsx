"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { completeCourseAttempt, startCourseAttempt, submitSlideResult } from "@/app/actions/attempts";
import { ActiveEditorProvider } from "@/components/course-builder/active-editor-context";
import { CANVAS_H, CANVAS_W } from "@/components/course-builder/slide-canvas";
import { SLIDE_TYPE_FACES } from "@/components/course-builder/slide-faces";
import { ExtraImagesLayer, SlideBackgroundLayer } from "@/components/course-builder/slide-faces/background-image-field";
import { SlideSelectionProvider } from "@/components/course-builder/slide-selection-context";
import { SnapGuideProvider } from "@/components/course-builder/snap-guide-context";
import { TextBoxPlacementProvider } from "@/components/course-builder/text-box-placement-context";
import { Button } from "@/components/ui/button";
import type { CourseAttempt } from "@/lib/attempt-types";
import type { Slide } from "@/lib/course-types";
import type { SlideInteractionResult } from "@/lib/slide-interaction";
import { cn } from "@/lib/utils";

export type PreviewSlide = { slide: Slide; lessonTitle: string };

// Passed only by the portal's real course-player page (portal/courses/[id]/
// page.tsx) — the admin's own Preview tab never passes this, so previewing
// a course as its author never creates a real attempt record. When
// present, this component starts a real CourseAttempt on mount, submits
// each slide's raw answer `detail` (never a claimed isCorrect/score — see
// submitSlideResult's own comment) as the learner progresses, and turns
// the last slide's disabled "Next" into a real "Finish" that completes the
// attempt and shows the server's own graded score.
export type AttemptTracking = {
  courseVersionId: string;
  isAssessment: boolean;
  passingScore: number | null;
};

// Scales the fixed 960x540 canvas (CANVAS_W/CANVAS_H — the same coordinate
// system the builder itself uses, so every slide face's percentage-based
// positioning renders identically here) up or down to fit entirely within
// however much space its container actually has — on BOTH axes, whichever
// is tighter, the same "object-fit: contain" idea CSS applies to an image
// inside a box, just applied to the whole interactive canvas. Measured live
// via ResizeObserver (reading the container's real rendered width AND
// height) rather than a fixed constant, since the available space varies
// (a modest admin preview pane vs. the much larger, full-screen portal
// course-player column) — and rather than deriving height from width via a
// fixed aspect-ratio (this component's original approach), which let the
// canvas grow arbitrarily tall on a wide-but-short container and push its
// own Previous/Next controls below the fold: confirmed via a real browser
// that the portal player needed a page scroll just to reach the Next
// button before this fix. A pure CSS width/aspect-ratio resize wouldn't
// work for the scaling itself either: font sizes inside a slide are
// literal pixel values (the toolbar's 1-34px font-size picker), which
// don't scale with a container's width on their own — only actually
// resizing the whole 960x540 box scales those px values along with
// everything else, the same way zooming a real slide deck would.
//
// Applied via the CSS `zoom` property below, deliberately NOT
// `transform: scale()` (slide-thumbnail.tsx's own technique) — confirmed
// via a real browser that missing_word's drag-and-drop present-mode
// interaction breaks under `transform: scale()`: dnd-kit's PointerSensor
// computes drag deltas from real screen-pixel pointer coordinates, but
// `transform: scale()` only affects PAINTING, not the coordinate system
// `getBoundingClientRect()`/pointer events report — so a chip's DragOverlay
// clone drifted away from the actual cursor position at exactly the
// ancestor's scale factor (a 10px real pointer move produced an 11px/1.2 =
// 12px clone move at scale 1.2). `zoom`, unlike `transform`, genuinely
// resizes the element's rendered layout box — every descendant coordinate
// API (getBoundingClientRect, pointer clientX/clientY) already accounts for
// it correctly, so dnd-kit needs no special handling at all. Trade-off:
// `zoom` is Chromium/Safari/Firefox 126+ (mid-2024) — no concern for this
// internal tool's browser support target.
function useStageScale() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || !rect.width || !rect.height) return;
      // Whichever axis is tighter wins — this is what actually guarantees
      // the canvas never exceeds its container on either dimension, rather
      // than just the one this hook used to check.
      setScale(Math.min(rect.width / CANVAS_W, rect.height / CANVAS_H));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { containerRef, scale };
}

// Read-only "slide through the deck" viewer — reuses the exact slide faces
// and canvas sizing the builder uses (CANVAS_W/CANVAS_H, SLIDE_TYPE_FACES)
// so a preview looks identical to the canvas, just non-interactive (except
// for interactive slide types' own "present" mode behavior — see
// onInteraction below).
export function CoursePreviewViewer({
  slides,
  maxWidthClassName = "max-w-6xl",
  attemptTracking,
}: {
  slides: PreviewSlide[];
  // Overridable so the portal's course-player page (a deliberately
  // full-screen, "presentation mode" experience — see portal/courses/[id]/
  // page.tsx) can let the stage grow far larger than the admin preview
  // tab's fixed-layout column, without changing that other, unrelated
  // caller's sizing at all. Defaults to this component's original cap.
  maxWidthClassName?: string;
  attemptTracking?: AttemptTracking;
}) {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);

  // Accumulates each interactive slide's result as the learner answers it,
  // keyed by slide id (re-answering the same slide replaces, never
  // duplicates). This local tally is a client-side, instant-feedback
  // convenience ONLY — it drives the live "Score so far" line below, never
  // anything that actually counts toward a pass/fail. When attemptTracking
  // is set, handleInteraction ALSO submits the raw `detail` to the server
  // (see submitSlideResult) — the server's own independent grading is what
  // actually accumulates into the attempt's real, persisted score.
  const [results, setResults] = useState<Record<string, SlideInteractionResult>>({});

  // Mirrors `attemptId` without handleInteraction needing to depend on it
  // (which would otherwise change identity on every attempt-start) — read
  // at call time via `.current`, always the latest value.
  const attemptIdRef = useRef<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [completedAttempt, setCompletedAttempt] = useState<CourseAttempt | null>(null);
  const [finishing, setFinishing] = useState(false);
  useEffect(() => {
    attemptIdRef.current = attemptId;
  }, [attemptId]);

  const isTrackingAttempt = Boolean(attemptTracking);

  // startCourseAttempt RESUMES an existing in_progress attempt at this
  // course version server-side if the learner already has one, rather than
  // always creating a new one (see CourseAttemptViewSet.perform_create) —
  // so this single call is all that's needed regardless of which case
  // applies. Reported directly as a real bug when this was still a
  // client-side "check, then create" two-step: simply reopening the course
  // player (a page refresh, a new tab, or just navigating back to it later
  // without ever clicking Finish) silently abandoned the old attempt and
  // created another — one user accumulated 16 attempt rows, 14 stuck
  // in_progress, just from normal back-and-forth browsing — and, since a
  // check-then-create is never atomic on its own, two near-simultaneous
  // calls (confirmed via a real browser: dev's React Strict Mode
  // double-invokes this very mount effect) could each see "no existing
  // attempt" and both create one anyway. Moving the resume-or-create logic
  // server-side, backed by a real DB-level UniqueConstraint (see
  // CourseAttempt.Meta), closes that race properly instead of narrowing it.
  //
  // Resuming also restores this attempt's already-submitted answers into
  // `results` — the same state a single remounted slide face restores via
  // `priorResult`, just sourced from the server's own `slide_results` since
  // there's no parent React state yet on a fresh page load. Without this, a
  // resumed session used to start with blank `results`, letting a learner
  // re-answer a question the server already had permanently, correctly
  // graded — quietly defeating the "permanent means permanent" assessment
  // guarantee one level up from where the remount-bypass fix closed it.
  //
  // A pure async action with no synchronous state resets of its own, so
  // it's safe to call directly from the mount effect below (setAttemptId/
  // setResults happen inside the .then() callback, not synchronously during
  // the effect body — the sanctioned "subscribe to an external system"
  // shape rather than the synchronous-setState-in-an-effect anti-pattern).
  const startAttempt = useCallback(() => {
    if (!attemptTracking) return;
    startCourseAttempt(attemptTracking.courseVersionId)
      .then((attempt) => {
        setAttemptId(attempt.id);
        if (attempt.slide_results.length === 0) return;
        const slideTypeById = new Map(slides.map((s) => [s.slide.id, s.slide.slide_type]));
        const restored: Record<string, SlideInteractionResult> = {};
        for (const slideResult of attempt.slide_results) {
          const slideType = slideTypeById.get(slideResult.slide);
          // Slide no longer exists on this version (shouldn't happen — a
          // published version's slides never change — but a resumed
          // attempt reaching across a version boundary isn't otherwise
          // ruled out, so skip rather than restore a result for a slide
          // that isn't actually in the deck being played).
          if (!slideType) continue;
          restored[slideResult.slide] = {
            slideId: slideResult.slide,
            slideType,
            isCorrect: slideResult.is_correct,
            score: slideResult.score,
            answeredAt: attempt.started_at,
            detail: slideResult.detail,
          };
        }
        setResults(restored);
      })
      .catch(() => {
        // Best-effort: if starting/resuming the attempt fails (network
        // hiccup), the learner can still browse the deck — handleInteraction
        // below simply has nothing to submit to until attemptId is set, and
        // Finish is disabled without one (see the render below).
      });
  }, [attemptTracking, slides]);

  useEffect(() => {
    startAttempt();
    // Mount-only — startAttempt itself is stable per attemptTracking
    // identity, and re-running this on every render would restart the
    // attempt endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Retake": a real user event (a button click), so synchronously
  // resetting local state here — unlike in the mount effect above — is
  // completely ordinary, not the pattern the lint rule warns about.
  function handleRetake() {
    setCompletedAttempt(null);
    setResults({});
    setCurrentIndex(0);
    setAttemptId(null);
    startAttempt();
  }

  const handleInteraction = useCallback(
    (result: SlideInteractionResult) => {
      setResults((prev) => ({ ...prev, [result.slideId]: result }));
      if (isTrackingAttempt && attemptIdRef.current) {
        // Best-effort/non-blocking — a network hiccup shouldn't freeze the
        // learner's flow through the deck. The client's own isCorrect/score
        // never leave the browser; only the raw `detail` does.
        submitSlideResult(attemptIdRef.current, result.slideId, result.detail).catch(() => {});
      }
    },
    [isTrackingAttempt],
  );

  async function handleFinish() {
    if (!attemptId) return;
    setFinishing(true);
    try {
      const attempt = await completeCourseAttempt(attemptId);
      setCompletedAttempt(attempt);
    } catch {
      // Best-effort: leave the learner on the last slide rather than
      // pretending completion succeeded — they can just click Finish again.
    } finally {
      setFinishing(false);
    }
  }

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

  const { containerRef, scale } = useStageScale();

  if (slides.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border-2 border-border bg-card p-6 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">No content yet — open the builder to add slides.</p>
      </div>
    );
  }

  const current = slides[clampedIndex];
  const Face = SLIDE_TYPE_FACES[current.slide.slide_type];
  // See slide-canvas.tsx's own isFreeformContent comment — a freeform
  // content slide's Face renders its own background/extra images
  // (interleaved with text per object_order), so the universal layers
  // below must be skipped for it here too, same reasoning.
  const isFreeformContent = current.slide.slide_type === "content" && current.slide.config.layout == null;

  return (
    // PositionableBox (used by content-slide-face.tsx's title/subtitle/
    // body/body2 fields, in every mode including "present") calls
    // useSlideSelection(), useActiveEditorContext(), AND useSnapGuides()
    // unconditionally — hooks, so they have to run on every render
    // regardless of mode, even though "present" mode's own early-return
    // path never actually reads any of the three. All four (now including
    // useTextBoxPlacement, called unconditionally by
    // freeform-content-slide.tsx's FreeformContentSlide — a FREEFORM
    // content slide's own present/static render path, not just "edit")
    // throw if their provider isn't anywhere above them in the tree.
    // course-builder.tsx already wraps its own tree in all four, but this
    // viewer is a genuinely separate top-level component tree — its own
    // route/page, never nested inside course-builder.tsx — so it never
    // inherited any of them. Confirmed via a real browser: previewing ANY
    // course containing a "content" slide 500'd the whole page — first on
    // the missing SlideSelectionProvider, then (after fixing just that) on
    // the missing ActiveEditorProvider, then the missing SnapGuideProvider
    // (missed in both of those earlier fixes, since it only throws once a
    // learner actually plays a course with a positioned text box rather
    // than just opening the admin preview tab) — TextBoxPlacementProvider
    // added proactively alongside the other three this time, specifically
    // because of that exact history, rather than waiting to hit the same
    // crash a fourth time. Same nesting order as course-builder.tsx, for
    // no particular reason beyond consistency — the providers don't
    // interact.
    <ActiveEditorProvider>
      <SlideSelectionProvider>
        <SnapGuideProvider>
          <TextBoxPlacementProvider>
          {/* h-full flex column: the caller (either the admin preview tab's
              self-stretch content slot, or the portal player's min-h-0
              flex-1 wrapper) is expected to hand this a genuinely bounded
              height — see those callers' own comments. The Previous/Slide/Next
              row below is shrink-0 (its own natural height); the stage region
              above it is the only flexible one, so it's the one that absorbs
              whatever room is actually left after that fixed-height row. */}
          <div className="flex h-full w-full flex-col items-center">
            {/* Lesson title shown only in the admin's own Preview tab — a
                real operative already knows roughly what they're watching, so
                this added little value in the portal player and just took up
                space there; isTrackingAttempt is only ever true for that real
                player, never the admin preview (see its own comment above). */}
            {!isTrackingAttempt && (
              <div className="mb-1 shrink-0 text-sm text-muted-foreground">{current.lessonTitle}</div>
            )}
  
            {/* The bounded region the stage fits itself into on BOTH axes —
                min-h-0 is required for a flex-1 item to be allowed to shrink
                below its content's intrinsic size at all (the default
                min-height:auto would otherwise let the 960x540 canvas keep
                this row exactly as tall as it wants, defeating the whole
                point). useStageScale's ResizeObserver reads THIS div's real
                rendered width and height and turns whichever is tighter into
                the inner canvas's zoom factor. */}
            <div className="flex min-h-0 w-full flex-1 items-center justify-center">
              <div
                ref={containerRef}
                className={cn("h-full w-full overflow-hidden rounded-lg bg-muted", maxWidthClassName)}
              >
                <div className="flex h-full w-full items-center justify-center">
                  <div
                    className="slide-surface relative overflow-hidden rounded-sm bg-white shadow-lg"
                    style={{ width: CANVAS_W, height: CANVAS_H, zoom: scale }}
                  >
                    {!isFreeformContent && (
                      <>
                        <SlideBackgroundLayer
                          value={current.slide.config.background_image_url}
                          mode="present"
                          xPct={current.slide.config.background_image_x_pct}
                          yPct={current.slide.config.background_image_y_pct}
                          widthPct={current.slide.config.background_image_width_pct}
                          heightPct={current.slide.config.background_image_height_pct}
                        />
                        <ExtraImagesLayer images={current.slide.config.extra_images ?? []} mode="present" />
                      </>
                    )}
                    <div className="relative z-10 h-full w-full">
                      <Face
                        key={current.slide.id}
                        slide={current.slide}
                        mode="present"
                        onInteraction={handleInteraction}
                        isAssessment={attemptTracking?.isAssessment}
                        priorResult={results[current.slide.id]}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
  
            {/* Running tally, not a full end-of-deck summary screen — shows once
                at least one interactive slide has been answered AND the
                course is actually flagged as an assessment. A non-assessment
                course has no pass/fail concept at all (see Course.is_assessment's
                own comment on the backend) — surfacing a live "X/Y correct"
                tally there read as a hidden test the learner never agreed to,
                for content that was only ever meant to be informational/
                practice. Admin preview (attemptTracking undefined — no real
                attempt is ever tracked there) keeps showing it regardless,
                same as before this changed: this is specifically about what a
                real learner sees while taking a non-assessment course, not a
                change to what the preview tab shows its author. Later stages
                (Missing Word, Match the Pair) need no changes here: they report
                through the same onInteraction/results shape.

                Always rendered (never conditionally mounted) — this row sits
                below the stage's own flex-1 min-h-0 region, so mounting it
                only once an answer comes in used to shrink the stage's
                available height right at that moment, and useStageScale
                would immediately shrink the canvas to match: reported as the
                page visibly "zooming out" the instant the last hotspot on a
                hotspot_image slide got clicked (hotspot_image reports its
                single completion event on the LAST click, unlike e.g.
                multiple_choice's first-and-only click, which is why it read
                as a "last press" bug specifically, though the same jump was
                always latent for every interactive type). visibility:hidden
                (not a conditional `&&`) keeps this row's height permanently
                reserved whether or not there's a score to show, so the
                stage's available height — and therefore its scale — never
                changes mid-interaction. */}
            <div
              className="mt-1 shrink-0 text-sm text-muted-foreground"
              style={{
                visibility:
                  answeredCount > 0 && (!attemptTracking || attemptTracking.isAssessment) ? "visible" : "hidden",
              }}
            >
              Score so far: {correctCount}/{answeredCount}
            </div>
  
            {/* size="xs" (was "sm") keeps this row's own footprint small
                without shrinking the buttons below the smallest size this
                app's Button component defines. py-2 (replacing the earlier
                plain mt-* margin) gives the row a real band of its own
                vertical breathing room, with items-center centering the
                buttons within that band instead of them sitting flush
                against the very bottom of the page. */}
            {completedAttempt ? (
              // The "moment of truth" — replaces the Previous/Next row once
              // Finish has been clicked and the SERVER (not this component's
              // own local `results` tally) has returned a graded score.
              <div className="flex shrink-0 items-center gap-4 py-2">
                <span className="text-sm font-medium">
                  {/* Backend grading.py still computes/stores a numeric
                      score for EVERY completed attempt regardless of
                      is_assessment (only `passed` is gated on it) — this
                      used to surface that raw number here even for a
                      non-assessment course, the same score-leak as the
                      running tally above, just at the end instead of
                      during. Gated the same way: only an assessment
                      course ever shows a number here. */}
                  {attemptTracking?.isAssessment && completedAttempt.score !== null
                    ? `You scored ${completedAttempt.score}%`
                    : "Course completed"}
                  {attemptTracking?.isAssessment && completedAttempt.passed !== null && (
                    <span className={completedAttempt.passed ? "text-primary" : "text-destructive"}>
                      {" — "}
                      {completedAttempt.passed
                        ? "Passed"
                        : `Not passed (minimum ${attemptTracking.passingScore}% required)`}
                    </span>
                  )}
                </span>
                <Button variant="outline" size="xs" onClick={handleRetake}>
                  Retake
                </Button>
                {/* Only ever reachable when attemptTracking is set (this block
                    only renders once completedAttempt exists, which only ever
                    happens via handleFinish, which is only wired up when
                    isTrackingAttempt — i.e. only in the real portal course
                    player, never the admin's own Preview tab), so a hardcoded
                    "/portal/courses" is safe here rather than needing a
                    caller-supplied exit route. */}
                <Button variant="outline" size="xs" onClick={() => router.push("/portal/courses")}>
                  Exit
                </Button>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-4 py-2">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={clampedIndex === 0}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Slide {clampedIndex + 1} of {slides.length}
                </span>
                {isTrackingAttempt && clampedIndex === slides.length - 1 ? (
                  <Button size="xs" onClick={handleFinish} disabled={finishing || !attemptId}>
                    {finishing ? "Finishing…" : "Finish"}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={clampedIndex === slides.length - 1}
                    onClick={() => setCurrentIndex((i) => Math.min(slides.length - 1, i + 1))}
                  >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
          </TextBoxPlacementProvider>
        </SnapGuideProvider>
      </SlideSelectionProvider>
    </ActiveEditorProvider>
  );
}
