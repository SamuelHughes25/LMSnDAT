"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HotspotMarker, Slide } from "@/lib/course-types";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { cn } from "@/lib/utils";
import { clampPositionPct, useImageUpload } from "./image-shared";
import type { SlideFaceProps } from "./index";

const CHANGE_DEBOUNCE_MS = 500;

// Backend-enforced hard cap (SlideSerializer.validate()'s hotspot_image
// branch) — no UI-guidance minimum, since zero hotspots (or no image yet)
// are both valid mid-authoring states, same leniency as every other type
// built this pass.
const MAX_HOTSPOTS = 10;

// Matches this app's existing dnd-kit sensor activation distance
// (PointerSensor's `activationConstraint: { distance: 4 }`, used in
// slide-rail.tsx and sequencing-slide-face.tsx) — kept as a plain local
// constant here since no dnd-kit is involved for hotspot markers at all,
// just raw pointer events, but the same "4px of slop before a gesture
// counts as a drag rather than a click" idea applies.
const DRAG_THRESHOLD_PX = 4;

function makeHotspotId(n: number) {
  return `hotspot_${n}_${Date.now().toString(36)}`;
}

export function HotspotImageSlideFace({ slide, mode, courseVersionId, onConfigChange, onInteraction }: SlideFaceProps) {
  const imageUrl = slide.config.hotspot_image_url ?? null;
  const hotspots = slide.config.hotspots ?? [];

  if (mode === "edit") {
    return (
      <HotspotImageEditor
        imageUrl={imageUrl}
        hotspots={hotspots}
        courseVersionId={courseVersionId}
        onConfigChange={onConfigChange}
      />
    );
  }

  if (mode === "present") {
    return <HotspotImagePresent slide={slide} imageUrl={imageUrl} hotspots={hotspots} onInteraction={onInteraction} />;
  }

  return <HotspotImageStatic imageUrl={imageUrl} hotspots={hotspots} />;
}

// Deliberate divergence from image-field.tsx's EditableImage/ResizeHandles:
// this image renders at a FIXED content region with object-fit: contain —
// no resize handles, no free repositioning of the image itself. A
// resizable/stretchable box (as image-left/image-right/background images
// use) would either distort the image (making hotspot xPct/yPct
// meaningless) or require re-deriving every marker's percentage on every
// resize — needless complexity for a feature never requested. useImageUpload
// and clampPositionPct (both from image-shared.tsx) are still reused
// directly for upload plumbing and coordinate clamping.
function HotspotImageEditor({
  imageUrl,
  hotspots,
  courseVersionId,
  onConfigChange,
}: {
  imageUrl: string | null;
  hotspots: HotspotMarker[];
  courseVersionId: string | undefined;
  onConfigChange: SlideFaceProps["onConfigChange"];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [localHotspots, setLocalHotspots] = useState(hotspots);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Live position while a marker is being dragged — purely local, same
  // "commit once on release, not per frame" idea used by every other raw-
  // pointer drag in this app (image-shared.tsx's ResizeHandles,
  // background-image-field.tsx's move band).
  const [liveDrag, setLiveDrag] = useState<{ id: string; xPct: number; yPct: number } | null>(null);

  // Named (not inline) so the Remove button below can call it directly
  // with `null` — same shape as image-field.tsx's ImageUploadField, whose
  // Remove button calls its own `onCommit(null)` directly, bypassing
  // useImageUpload's upload flow entirely since removal isn't an upload.
  function handleImageCommit(url: string | null) {
    if (!url) {
      // Removing the image also clears hotspots in the same commit — an
      // orphaned marker set (pointing at percentages of an image that no
      // longer exists) is meaningless, same "clear on incompatible state
      // change" precedent as content-slide-face.tsx's layout picker
      // clearing box_transforms.
      setLocalHotspots([]);
      setEditingId(null);
      onConfigChange?.({ hotspot_image_url: null, hotspots: [] });
      return;
    }
    onConfigChange?.({ hotspot_image_url: url });
  }

  const { uploading, error, inputRef, handleFileChange, handlePaste } = useImageUpload(
    courseVersionId,
    handleImageCommit,
  );

  // Claims focus as soon as this slide's editor mounts with no image yet
  // (a freshly-created hotspot_image slide, or switching into one from
  // another slide — this component remounts on slide change via
  // key={slide.id} in slide-canvas.tsx), so Ctrl+V works immediately
  // without an extra click first. Same fix, and the same reasoning, as
  // image-field.tsx's ImageUploadField — see its comment for the full
  // repro this addresses.
  useEffect(() => {
    if (!imageUrl) containerRef.current?.focus();
    // Deliberately mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debouncedCommitHotspots = useDebouncedCallback(
    (next: HotspotMarker[]) => onConfigChange?.({ hotspots: next }),
    CHANGE_DEBOUNCE_MS,
  );

  function commitHotspots(next: HotspotMarker[]) {
    setLocalHotspots(next);
    onConfigChange?.({ hotspots: next });
  }

  // Closes any open hotspot's edit panel whenever a pointerdown lands
  // outside the whole image container — clicking the properties panel, the
  // hint text below the image, or anywhere else on the slide. Mirrors
  // background-image-field.tsx's identical "click outside to deselect"
  // pattern. Only active while a panel is actually open, so it costs
  // nothing the rest of the time.
  useEffect(() => {
    if (!editingId) return;
    function handlePointerDownOutside(e: PointerEvent) {
      const container = containerRef.current;
      if (container && e.target instanceof Node && !container.contains(e.target)) {
        setEditingId(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDownOutside, true);
    return () => document.removeEventListener("pointerdown", handlePointerDownOutside, true);
  }, [editingId]);

  // Placement only fires when the click target IS the container itself —
  // a click that bubbled up from a marker (the target is that marker's own
  // element, a descendant) is excluded automatically, no stopPropagation
  // needed anywhere.
  //
  // Whenever a panel is already open, this click's ONLY job is to close
  // it — it deliberately does NOT also place a new hotspot at the same
  // click. Without this split, clicking the image just to dismiss the
  // panel (to see the image underneath it) always planted another marker
  // in the same motion, with no way to close a panel without creating —
  // and then having to immediately delete — an unwanted extra hotspot.
  // Placement only resumes on a later click, once nothing is open.
  function handleContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (editingId) {
      setEditingId(null);
      return;
    }
    if (!imageUrl || localHotspots.length >= MAX_HOTSPOTS) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = clampPositionPct(((e.clientX - rect.left) / rect.width) * 100);
    const yPct = clampPositionPct(((e.clientY - rect.top) / rect.height) * 100);
    const id = makeHotspotId(localHotspots.length + 1);
    const next = [...localHotspots, { id, xPct, yPct, label: "" }];
    commitHotspots(next);
    setEditingId(id);
  }

  function handleMarkerMove(id: string, xPct: number, yPct: number) {
    setLiveDrag({ id, xPct, yPct });
  }

  function handleMarkerCommitMove(id: string, xPct: number, yPct: number) {
    setLiveDrag(null);
    commitHotspots(localHotspots.map((h) => (h.id === id ? { ...h, xPct, yPct } : h)));
  }

  function handleMarkerClick(id: string) {
    setEditingId((current) => (current === id ? null : id));
  }

  function handleLabelChange(id: string, value: string) {
    const next = localHotspots.map((h) => (h.id === id ? { ...h, label: value } : h));
    setLocalHotspots(next);
    debouncedCommitHotspots(next);
  }

  function handleDescriptionChange(id: string, value: string) {
    const next = localHotspots.map((h) => (h.id === id ? { ...h, description: value } : h));
    setLocalHotspots(next);
    debouncedCommitHotspots(next);
  }

  function removeMarker(id: string) {
    setEditingId(null);
    commitHotspots(localHotspots.filter((h) => h.id !== id));
  }

  return (
    <div className="flex h-full w-full flex-col gap-2 px-16 py-12 text-foreground">
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        tabIndex={0}
        onPaste={handlePaste}
        className={cn(
          "group relative min-h-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          // Muted background only while there's no image yet — it's the
          // visual affordance for "this is an empty dropzone." Once an
          // image is set, the goal is "just the plain image showing with
          // hotspots," not a grey card behind it — object-contain
          // letterboxes a non-square image inside this box, and that
          // letterboxed space should read as transparent (blending into
          // the slide's own white canvas), not as a colored backdrop.
          !imageUrl && "bg-muted",
        )}
      >
        <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

        {imageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded
                asset URL isn't a static/known-domain import next/image can
                optimize; see image-field.tsx's identical note. */}
            <img src={imageUrl} alt="" className="pointer-events-none h-full w-full rounded-md object-contain" />
            <div className="pointer-events-none absolute inset-0 flex items-start justify-end gap-2 p-2 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="pointer-events-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                disabled={uploading}
              >
                Replace
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="pointer-events-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  handleImageCommit(null);
                }}
                disabled={uploading}
                aria-label="Remove image"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {localHotspots.map((hotspot, index) => {
              const effective = liveDrag?.id === hotspot.id ? liveDrag : hotspot;
              return (
                <MarkerPin
                  key={hotspot.id}
                  index={index}
                  xPct={effective.xPct}
                  yPct={effective.yPct}
                  found={false}
                  containerRef={containerRef}
                  onMove={(x, y) => handleMarkerMove(hotspot.id, x, y)}
                  onCommitMove={(x, y) => handleMarkerCommitMove(hotspot.id, x, y)}
                  onClick={() => handleMarkerClick(hotspot.id)}
                />
              );
            })}

            {localHotspots.map((hotspot) => {
              if (editingId !== hotspot.id) return null;
              const effective = liveDrag?.id === hotspot.id ? liveDrag : hotspot;
              return (
                <div
                  key={hotspot.id}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute z-20 flex w-56 flex-col gap-1.5 rounded-lg border border-border bg-white p-2 shadow-lg"
                  style={{ left: `${effective.xPct}%`, top: `${effective.yPct}%`, transform: "translate(-50%, 14px)" }}
                >
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      value={hotspot.label}
                      onChange={(e) => handleLabelChange(hotspot.id, e.target.value)}
                      placeholder="Label"
                      className="flex-1"
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeMarker(hotspot.id)} aria-label="Remove hotspot">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <textarea
                    value={hotspot.description ?? ""}
                    onChange={(e) => handleDescriptionChange(hotspot.id, e.target.value)}
                    placeholder="Description (optional)"
                    rows={2}
                    className="w-full resize-y rounded border border-border bg-transparent p-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary/40"
                  />
                </div>
              );
            })}
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground/60">
            {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
            <div className="text-center text-sm">
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
                    disabled={!courseVersionId}
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
      {imageUrl && (
        <div className="text-xs text-muted-foreground">
          Click the image to add a hotspot ({localHotspots.length}/{MAX_HOTSPOTS}). Click a marker to edit it, or drag to
          reposition.
        </div>
      )}
    </div>
  );
}

function MarkerPin({
  index,
  xPct,
  yPct,
  found,
  containerRef,
  onMove,
  onCommitMove,
  onClick,
}: {
  index: number;
  xPct: number;
  yPct: number;
  found: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onMove?: (xPct: number, yPct: number) => void;
  onCommitMove?: (xPct: number, yPct: number) => void;
  onClick: () => void;
}) {
  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container || !onMove || !onCommitMove) {
      onClick();
      return;
    }
    // Captured into their own definitely-non-null consts: TypeScript's
    // narrowing from the guard above doesn't carry into the nested
    // onPointerMove/onPointerUp closures below, which would otherwise still
    // see the wider `((...) => void) | undefined` prop types — same fix
    // shape as positionable-box.tsx's handleMovePointerDown/
    // handleResizePointerDown.
    const move = onMove;
    const commitMove = onCommitMove;
    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let finalX = xPct;
    let finalY = yPct;

    function onPointerMove(moveEvent: PointerEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      finalX = clampPositionPct(((moveEvent.clientX - rect.left) / rect.width) * 100);
      finalY = clampPositionPct(((moveEvent.clientY - rect.top) / rect.height) * 100);
      move(finalX, finalY);
    }
    function onPointerUp() {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      if (moved) {
        commitMove(finalX, finalY);
      } else {
        onClick();
      }
    }
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }

  return (
    <div
      onPointerDown={handlePointerDown}
      className={cn(
        "absolute z-10 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow-md",
        found ? "bg-green-600" : "bg-primary",
      )}
      style={{ left: `${xPct}%`, top: `${yPct}%` }}
    >
      {index + 1}
    </div>
  );
}

// Genuinely interactive learner-facing render. No "correct answer" — every
// placed hotspot is "correct" simply by existing — so this is tracked as
// completion (every hotspot found at least once), not correctness. See
// slide-interaction.ts's doc comment.
function HotspotImagePresent({
  slide,
  imageUrl,
  hotspots,
  onInteraction,
}: {
  slide: Slide;
  imageUrl: string | null;
  hotspots: HotspotMarker[];
  onInteraction: SlideFaceProps["onInteraction"];
}) {
  const [foundIds, setFoundIds] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // In an actual presentation, clicking a pin again (or a different pin)
  // isn't the only realistic way someone tries to dismiss a popup — they
  // click wherever, expecting it to go away. Mirrors the identical
  // "click outside closes it" pattern already used for the editor's own
  // hotspot panels and background-image-field.tsx's controls: closes
  // whenever a pointerdown lands outside the currently-open panel itself.
  // A click on a *different* pin still opens that one correctly — its own
  // onClick (fired on pointerUP, after this listener's pointerDOWN) sets
  // openId to the new id, overriding whatever this effect set moments
  // earlier — so pin-to-pin clicking was never at risk of a race here.
  useEffect(() => {
    if (!openId) return;
    function handlePointerDownOutside(e: PointerEvent) {
      const panel = panelRef.current;
      if (panel && e.target instanceof Node && !panel.contains(e.target)) {
        setOpenId(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDownOutside, true);
    return () => document.removeEventListener("pointerdown", handlePointerDownOutside, true);
  }, [openId]);

  // Reads foundIds directly from the closure and calls setFoundIds with a
  // plain computed value, rather than a functional updater — same shape as
  // match-pairs-slide-face.tsx's handleDefinitionClick, accordion-slide-
  // face.tsx's toggleSection, and flashcards-slide-face.tsx's goTo. See
  // those for why: a setState updater isn't guaranteed to run only once,
  // synchronously, inside the handler that scheduled it, and nesting the
  // onInteraction call inside one let React invoke it during a later render
  // pass here too, confirmed in a real browser to throw "Cannot update a
  // component while rendering a different component."
  function handleMarkerClick(id: string) {
    setOpenId((current) => (current === id ? null : id));

    if (!foundIds.has(id)) {
      const next = new Set(foundIds).add(id);
      setFoundIds(next);
      if (next.size === hotspots.length && !reported) {
        setReported(true);
        onInteraction?.({
          slideId: slide.id,
          slideType: slide.slide_type,
          isCorrect: true,
          score: 1,
          answeredAt: new Date().toISOString(),
          detail: { foundHotspotIds: Array.from(next) },
        });
      }
    }
  }

  if (!imageUrl) {
    return <div className="flex h-full w-full flex-col px-16 py-12 text-foreground" />;
  }

  return (
    <div className="flex h-full w-full flex-col px-16 py-12 text-foreground">
      <div className="relative min-h-0 flex-1 rounded-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="h-full w-full rounded-md object-contain" />
        {hotspots.map((hotspot, index) => (
          <MarkerPin
            key={hotspot.id}
            index={index}
            xPct={hotspot.xPct}
            yPct={hotspot.yPct}
            found={foundIds.has(hotspot.id)}
            containerRef={{ current: null }}
            onClick={() => handleMarkerClick(hotspot.id)}
          />
        ))}
        {hotspots.map((hotspot) => {
          if (openId !== hotspot.id) return null;
          return (
            <div
              key={hotspot.id}
              ref={panelRef}
              className="absolute z-20 w-56 rounded-lg border border-border bg-white p-3 shadow-lg"
              style={{ left: `${hotspot.xPct}%`, top: `${hotspot.yPct}%`, transform: "translate(-50%, 14px)" }}
            >
              {/* break-words (overflow-wrap: break-word): the card's width
                  is fixed (w-56) but its height was already auto — a plain
                  block box with no explicit height grows to fit its
                  content's wrapped line count on its own. The actual bug
                  was purely horizontal: a label/description with no
                  natural break point (one long unbroken word, e.g. a long
                  identifier or URL) has nowhere to wrap under the default
                  overflow-wrap, so it just ran past the card's own right
                  edge instead — confirmed in a real browser (388px of
                  content inside a 223px box). break-words forces even an
                  unbroken run of characters to wrap at the box's own edge,
                  which is what actually keeps text "contained," not
                  anything about height. */}
              <div className="font-semibold break-words">{hotspot.label || "—"}</div>
              {hotspot.description && (
                <div className="mt-1 text-sm break-words text-muted-foreground">{hotspot.description}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Thumbnail render — image at true-miniature scale, hotspots as small plain
// dots (no numbers, no click handlers). No-image state reuses the same
// muted empty box image-field.tsx's ImageStatic already uses.
function HotspotImageStatic({ imageUrl, hotspots }: { imageUrl: string | null; hotspots: HotspotMarker[] }) {
  if (!imageUrl) {
    return (
      <div className="flex h-full w-full flex-col px-16 py-12 text-foreground">
        <div className="h-full w-full rounded-md bg-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col px-16 py-12 text-foreground">
      <div className="relative h-full w-full rounded-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="h-full w-full rounded-md object-contain" />
        {hotspots.map((hotspot) => (
          <div
            key={hotspot.id}
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
            style={{ left: `${hotspot.xPct}%`, top: `${hotspot.yPct}%` }}
          />
        ))}
      </div>
    </div>
  );
}
