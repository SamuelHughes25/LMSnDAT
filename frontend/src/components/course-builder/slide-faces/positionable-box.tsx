"use client";

import { useLayoutEffect, useRef, useState } from "react";

import type { BoxTransform } from "@/lib/course-types";
import { cn } from "@/lib/utils";
import { useActiveEditorContext } from "../active-editor-context";
import { useSlideSelection } from "../slide-selection-context";
import { HANDLES, type HandleDir, clampPositionPct } from "./image-shared";
import type { SlideFaceProps } from "./index";

// Width of the invisible "grab to move" band just inside the box's own
// edges — see the perimeter strips below.
const MOVE_BAND_PX = 10;

// Text boxes' OWN size clamp — deliberately NOT image-shared.tsx's
// clampSizePct (whose 20% floor is tuned for images, which default to
// 100% size). A title's natural single-line height is only ~7% of the
// slide, well BELOW that 20% floor — confirmed via a real browser that
// grabbing any resize handle with a vertical component (a corner, or a
// pure N/S edge) instantly clamped the height UP to 20% the moment the
// drag began, before the pointer had even moved, since 20% floor > the
// box's actual ~7% starting height. Combined with the opposite-edge
// anchor math (`yPct = bottomAnchor - heightPct`), that sudden +13-point
// height jump pushed the box's top edge to a NEGATIVE yPct — off the top
// of the canvas, clipped there — and because the floor is a floor, no
// further drag could ever bring it back down: "jumps out of place the
// instant you resize it, and can't be resized back down" was this exact
// mechanism, not a text-wrapping bug (SINGLE_LINE_TYPOGRAPHY in
// content-slide-face.tsx was never actually broken). 4% (~22px on this
// app's fixed 540px-tall canvas) is comfortably below any single line's
// natural height at any of this face's font sizes, so it only ever
// stops a box from being shrunk to literally-invisible, never forces an
// unwanted jump on a normal-sized resize.
const TEXT_MIN_SIZE_PCT = 4;
const TEXT_MAX_SIZE_PCT = 300;

function clampTextSizePct(v: number): number {
  return Math.min(TEXT_MAX_SIZE_PCT, Math.max(TEXT_MIN_SIZE_PCT, v));
}

// (xPct, yPct) here is the box's TOP-LEFT corner, not its center —
// deliberately different from image-shared.tsx's imageBoxStyle (which
// centers the box on (xPct, yPct) and keeps that center fixed while
// resizing). That center-anchored model is correct for the free-floating
// background image (confirmed explicitly for it) but was the wrong model
// for text boxes: resizing a text box from a corner/edge handle is
// conventionally expected to keep the OPPOSITE corner/edge fixed (drag the
// bottom-right handle, the top-left stays put — the standard behavior in
// every familiar text/shape editor), not keep the center fixed and move
// both corners at once. No translate needed here since there's no
// centering to do — top/left/width/height are the box's real edges
// directly.
function topLeftBoxStyle(xPct: number, yPct: number, widthPct: number, heightPct: number): React.CSSProperties {
  return {
    position: "absolute",
    top: `${yPct}%`,
    left: `${xPct}%`,
    width: `${widthPct}%`,
    height: `${heightPct}%`,
  };
}

// Makes a single text box (title/subtitle/body/body2) freely draggable and
// resizable, independent of the background-image system in
// background-image-field.tsx — separate config (config.box_transforms, not
// anything image-related), separate refs, separate drag state, and (see
// topLeftBoxStyle above) a deliberately different resize anchor model. The
// two only share the low-level positioning primitives in image-shared.tsx
// that are genuinely identical either way (size clamping, the resize
// handles' visual layout), not any runtime state or drag math.
//
// A box with no saved transform yet renders exactly as it always has — a
// normal flex child, sized by whichever layout is active, via
// `flexClassName` (the same className that used to sit directly on the
// wrapping <div> in each content-slide-face.tsx layout branch) — with a
// perimeter move band and (once selected) resize handles overlaid on top
// of its current rendered position (edit mode only). The FIRST drag or
// resize measures that current position (via getBoundingClientRect,
// converted to a percentage of the slide) and uses it as the starting
// point, then commits a real transform on release — from then on the box
// renders absolutely positioned at its saved (x, y, width, height) instead
// of participating in flex layout at all. This is what "layout sets the
// starting position, then drag it anywhere" means in code: the layout's
// flex math is the *fallback* for an untouched box, not something this
// component duplicates.
//
// Percentages are relative to the slide's own top-level box in
// content-slide-face.tsx (the outer `w-full h-full` div each layout
// branch returns), not a ref threaded down from slide-canvas.tsx — that
// div is already exactly the full slide's size (padding doesn't shrink a
// CSS percentage's containing block), so measuring against it directly
// gives identical numbers without content-slide-face.tsx needing to know
// anything about how its parent mounts it.
export function PositionableBox({
  fieldKey,
  slideId,
  transform,
  onTransform,
  mode,
  slideRef,
  flexClassName,
  children,
}: {
  fieldKey: string;
  // Which slide this box belongs to — combined with fieldKey below into a
  // globally-unique selection id, since "title"/"body"/etc. alone repeat on
  // every slide. See slide-selection-context.tsx's comment on why
  // namespacing this way (rather than resetting the shared context on slide
  // change) is what's actually needed here.
  slideId: string;
  transform: BoxTransform | undefined;
  onTransform: (t: BoxTransform) => void;
  mode: SlideFaceProps["mode"];
  slideRef: React.RefObject<HTMLElement | null> | undefined;
  flexClassName?: string;
  children: React.ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<BoxTransform | null>(null);
  // Only populated for an untransformed box in edit mode — see the
  // layout effect below. Static/present renders never need it: a
  // transform is resolved purely by CSS percentages, and an untransformed
  // box there is just plain flex-flow content, same as always.
  const [measuredBaseline, setMeasuredBaseline] = useState<BoxTransform | null>(null);
  // Gates the resize handles: they only show once this box is "selected"
  // (focus has entered its own text editor, or the perimeter move band has
  // been grabbed at least once), not for every box on the slide all the
  // time. Set on focus-within and on the first move-drag; cleared on
  // blur-out, guarded against the formatting toolbar the same way
  // RichTextBody's own onBlur is (see content-slide-face.tsx) — otherwise
  // clicking a Bold/Italic button in the toolbar would look like focus
  // left the box and hide its handles mid-format.
  //
  // Derived from the SHARED slide-selection-context, not local state: a
  // move/resize drag has to preventDefault() on pointerdown (to suppress
  // native click/text-selection behavior while dragging), which as a side
  // effect also suppresses the native blur that would otherwise fire on
  // whichever OTHER box was previously focused — so that other box never
  // finds out it should deselect. Routing "am I selected" through one
  // shared slot instead of independent local state means selecting this
  // box automatically overwrites the slot and every other box's own
  // isSelected goes false on the very next render, regardless of whether
  // its native focus/blur ever fired. See slide-selection-context.tsx.
  const selectionId = `${slideId}:${fieldKey}`;
  const { selectedId, select, deselect } = useSlideSelection();
  const isSelected = selectedId === selectionId;
  const { toolbarRef, toolbarInteractingRef } = useActiveEditorContext();

  // Runs after the DOM commits, before paint — the one-time measurement
  // that lets an untouched box's grip/handles appear at its actual current
  // position without content-slide-face.tsx having to pre-compute what
  // every layout's flex math would produce.
  //
  // `slideRef` (an ancestor several components up, attached in
  // slide-canvas.tsx's Face wrapper) is confirmed — by instrumenting this
  // exact effect and comparing it against a requestAnimationFrame retry —
  // to sometimes still read `.current === null` on this component's very
  // first layout effect pass, becoming available only a frame later, even
  // though `wrapperRef` (owned by this component itself) is always ready
  // in time. This is a real ordering quirk of this specific nesting depth,
  // not a logic bug: React doesn't guarantee a distant ancestor's ref is
  // attached before a descendant's layout effect runs, only that a ref and
  // ITS OWN component's effects are consistent. The retry loop below
  // (bounded to a few frames, not unbounded) is the fix — it's cheap,
  // self-limiting, and only ever runs for the small handful of frames
  // until the ancestor ref catches up, typically just one.
  useLayoutEffect(() => {
    if (mode !== "edit" || transform) return;
    let rafId: number | null = null;
    let attempts = 0;

    function attemptMeasure() {
      const wrapper = wrapperRef.current;
      const slide = slideRef?.current;
      if (!wrapper || !slide) {
        attempts += 1;
        if (attempts < 10) {
          rafId = requestAnimationFrame(attemptMeasure);
        }
        return;
      }
      const wrapperRect = wrapper.getBoundingClientRect();
      const slideRect = slide.getBoundingClientRect();
      // Top-left corner, not center — see topLeftBoxStyle's comment.
      setMeasuredBaseline({
        xPct: ((wrapperRect.x - slideRect.x) / slideRect.width) * 100,
        yPct: ((wrapperRect.y - slideRect.y) / slideRect.height) * 100,
        widthPct: (wrapperRect.width / slideRect.width) * 100,
        heightPct: (wrapperRect.height / slideRect.height) * 100,
      });
    }
    attemptMeasure();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
    // Deliberately no dependency on wrapper/slide size or content — the
    // canvas is a fixed-pixel-size element (CANVAS_W/CANVAS_H in
    // slide-canvas.tsx), not responsive to window size, so an
    // untransformed box's flex position/size can't change after mount
    // without `layout` itself changing (which remounts this component via
    // key={`${field}-${layout}`} — see content-slide-face.tsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, transform]);

  // The box's position/size to actually START a drag from — measured FRESH
  // right now, not read from `measuredBaseline` state. `measuredBaseline`
  // is captured once, on mount, and then frozen (see the layout effect
  // above); that's fine for the ONE thing it's still used for below
  // (placing the always-visible perimeter band before the box has ever
  // been touched), but it's the wrong source of truth for what a drag
  // should actually COMMIT, because that one-shot mount measurement can
  // itself be stale. Confirmed via a real browser + instrumented logging:
  // TipTap's editor content doesn't necessarily exist in the DOM on the
  // very first layout-effect pass (immediatelyRender: false delays it),
  // so a box whose true content hasn't painted yet can measure as
  // collapsed/near-zero — and for `body`, whose flex position depends on
  // `title`'s settled height (both are stacked in the same flex column),
  // that meant body's frozen baseline reflected "right below a
  // still-collapsed title" rather than body's real, later position once
  // title's actual height applied — a permanent ~40px error, reproduced
  // exactly matching the report of a first drag jumping "up to the bottom
  // of the title box." React's dev-only StrictMode double-invoking this
  // effect happened to self-correct it in earlier manual testing (a
  // second, later measurement overwriting the bad first one) — but that's
  // a dev-mode accident to fix, not something to depend on: production
  // builds never double-invoke, so the same race could freeze in the BAD
  // measurement there with no second pass to correct it. Re-measuring at
  // the moment a drag actually begins sidesteps the whole timing question
  // instead of chasing exactly when content has "settled": by definition,
  // if the user can see and click the box, its current DOM position is
  // already correct, so asking for it right then is always safe.
  function measureFreshBaseline(): BoxTransform | null {
    if (transform) return transform;
    const wrapper = wrapperRef.current;
    const slide = slideRef?.current;
    if (!wrapper || !slide) return measuredBaseline;
    const wrapperRect = wrapper.getBoundingClientRect();
    const slideRect = slide.getBoundingClientRect();
    return {
      xPct: ((wrapperRect.x - slideRect.x) / slideRect.width) * 100,
      yPct: ((wrapperRect.y - slideRect.y) / slideRect.height) * 100,
      widthPct: (wrapperRect.width / slideRect.width) * 100,
      heightPct: (wrapperRect.height / slideRect.height) * 100,
    };
  }

  if (mode !== "edit") {
    if (!transform) return <>{children}</>;
    // z-10 for the same reason as the edit-mode return below: a
    // transformed box can visually overlap an untransformed sibling still
    // in normal flex flow, and without an explicit stacking order they'd
    // fall back to DOM order, which isn't necessarily what was intended.
    // overflow-hidden lives on the INNER wrapper (around just the
    // content), not this outer positioned box — see the identical note on
    // the edit-mode return below for why that split matters.
    return (
      <div className="absolute z-10" style={topLeftBoxStyle(transform.xPct, transform.yPct, transform.widthPct, transform.heightPct)}>
        <div className="h-full w-full overflow-hidden">{children}</div>
      </div>
    );
  }

  const baseline = transform ?? measuredBaseline;

  function commit(next: BoxTransform) {
    setLive(null);
    onTransform(next);
  }

  function handleMovePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    select(selectionId);
    const slide = slideRef?.current;
    const startMaybe = measureFreshBaseline();
    if (!slide || !startMaybe) return;
    // Captured into its own definitely-non-null const: TypeScript's
    // narrowing from the guard above doesn't carry into the nested
    // closures below (onMove/onUp), which still see the wider
    // `BoxTransform | null` type of `startMaybe` otherwise.
    const start: BoxTransform = startMaybe;
    const rect = slide.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let current = start;

    function onMove(moveEvent: PointerEvent) {
      current = {
        ...start,
        xPct: clampPositionPct(start.xPct + ((moveEvent.clientX - startX) / rect.width) * 100),
        yPct: clampPositionPct(start.yPct + ((moveEvent.clientY - startY) / rect.height) * 100),
      };
      setLive(current);
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      commit(current);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  // Opposite-edge-anchored resize: dragging the "e" (east) handle only
  // ever grows/shrinks width, from the box's existing left edge — that
  // edge (x) never moves. Dragging "w" moves the left edge itself, so the
  // RIGHT edge (start.xPct + start.widthPct) is computed once as the fixed
  // anchor, and x is *derived* from it every frame (`anchor - width`) —
  // deriving it this way, rather than tracking x and width as two
  // independent deltas, is what guarantees the anchor edge is still
  // exactly fixed even once width hits the MIN/MAX clamp, not just
  // "usually" fixed. "n"/"s" do the same on the vertical axis. This
  // replaces an earlier version of this component that reused the
  // free-floating image's center-anchored math (imageBoxStyle) for text
  // boxes too — confirmed in a real browser to be the wrong model here:
  // dragging any handle visibly moved the box's top-left corner, since
  // center-anchoring moves both corners at once by design.
  function handleResizePointerDown(dir: HandleDir, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    select(selectionId);
    const slide = slideRef?.current;
    const startMaybe = measureFreshBaseline();
    if (!slide || !startMaybe) return;
    const start: BoxTransform = startMaybe;
    const rect = slide.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const rightAnchor = start.xPct + start.widthPct;
    const bottomAnchor = start.yPct + start.heightPct;
    let current = start;

    function onMove(moveEvent: PointerEvent) {
      const dxPct = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dyPct = ((moveEvent.clientY - startY) / rect.height) * 100;
      let { xPct, yPct, widthPct, heightPct } = start;

      if (dir.includes("e")) {
        widthPct = clampTextSizePct(start.widthPct + dxPct);
      }
      if (dir.includes("w")) {
        widthPct = clampTextSizePct(start.widthPct - dxPct);
        xPct = rightAnchor - widthPct;
      }
      if (dir.includes("s")) {
        heightPct = clampTextSizePct(start.heightPct + dyPct);
      }
      if (dir.includes("n")) {
        heightPct = clampTextSizePct(start.heightPct - dyPct);
        yPct = bottomAnchor - heightPct;
      }

      current = { xPct, yPct, widthPct, heightPct };
      setLive(current);
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      commit(current);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function handleFocus() {
    select(selectionId);
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    const nextFocus = e.relatedTarget;
    const toolbarEl = toolbarRef.current;
    const focusMovedIntoToolbar = !!(toolbarEl && nextFocus instanceof Node && toolbarEl.contains(nextFocus));
    const focusStayedInBox = !!(nextFocus && e.currentTarget.contains(nextFocus as Node));
    if (focusMovedIntoToolbar || toolbarInteractingRef.current || focusStayedInBox) {
      return;
    }
    deselect(selectionId);
  }

  const effective = live ?? baseline;

  // Whether this box renders absolutely-positioned (topLeftBoxStyle) at
  // all — deliberately NOT just `!!transform`. `transform` only reflects
  // the last COMMITTED (saved-to-config) position; gating render on it
  // alone meant a box's very FIRST drag/resize had nowhere to show its
  // live in-progress position, since `live` was updating every pointermove
  // but the box kept rendering at its old flex position throughout the
  // whole gesture (transform stayed undefined until pointerup) — then
  // visually snapped straight to the final spot the instant the drag
  // ended. Confirmed via a real browser: only the FIRST drag ever did
  // this; every drag after that felt live, because by then `transform`
  // was already truthy from the start. Gating on `transform || live`
  // instead means the very first drag also renders from `live` (itself
  // seeded from the same measured baseline `transform` would have used),
  // so it feels identical to every drag after it.
  const isPositioned = !!(transform || live);

  return (
    <div
      ref={wrapperRef}
      onFocus={handleFocus}
      onBlur={handleBlur}
      // Transformed boxes escape flex flow and can visually overlap an
      // untransformed sibling still in its normal flex position (e.g. drag
      // the title down into the space body normally occupies) — z-10 (vs.
      // an untransformed sibling's implicit z-auto) keeps a transformed box
      // on top of anything untouched, so it's never silently buried by a
      // later-rendered-but-still-static sibling.
      //
      // The currently SELECTED box additionally jumps to z-30, above every
      // other transformed-but-unselected box (still z-10) — otherwise,
      // whichever box happens to render later in the JSX (body always
      // after title) permanently wins any visual overlap regardless of
      // which one the user is actually trying to work with, burying that
      // box's own perimeter band and resize handles with no way to grab
      // them. Selecting a box now visibly brings it to the front, the same
      // way clicking an object in front-to-back-ordered design tools
      // (PowerPoint, Figma, etc.) conventionally surfaces it. This doesn't
      // help selecting a box that's 100% fully covered with no exposed
      // pixel to click at all — there's no click target left to grab in
      // that case, an inherent limit of pointer-based selection rather
      // than something this z-index change can fix — but it's enough for
      // the much more common partial-overlap case, since z-30 applies to
      // the box's ENTIRE bounds (including any portion that was previously
      // hidden) the moment any exposed sliver of it is clicked.
      className={cn(
        "relative",
        !isPositioned && flexClassName,
        isPositioned && "absolute",
        isPositioned && (isSelected ? "z-30" : "z-10"),
      )}
      style={isPositioned && effective ? topLeftBoxStyle(effective.xPct, effective.yPct, effective.widthPct, effective.heightPct) : undefined}
    >
      {/* overflow-hidden lives HERE, on the inner content wrapper, not on
          the outer positioned box above — it used to sit on the outer box,
          which also hosts the resize handles below. Those handles are
          deliberately positioned just OUTSIDE the box's own edges (e.g.
          top: -5px) so they're easy to grab; putting overflow-hidden on
          their own container clipped most of them the instant a box
          became transformed (mode="edit", `transform` truthy) — exactly
          the "most of the dots go missing after resizing" bug. Confirmed
          via a real browser: before this fix, 6-7 of the 8 handles
          (everything but whichever sat flush with a non-clipped edge)
          disappeared right after the first resize commit; after, all 8
          stay visible regardless of how many times the box has been
          resized. Text still gets clipped to the box's own bounds exactly
          as before — clipping just moved to the element that's supposed
          to own it. */}
      <div className="h-full w-full overflow-hidden">{children}</div>

      {baseline && slideRef && (
        <>
          {/* Perimeter move band: four thin strips hugging the INSIDE of
              the box's edges, each a plain "cursor: move" + drag-to-move
              target — not a single center-positioned grip button (an
              earlier design). A center grip sat exactly where a click to
              place the text cursor would land, and `opacity-0` (needed so
              an always-visible grip wasn't cluttering the slide) doesn't
              remove an element from hit-testing, so it silently swallowed
              every click aimed at the middle of the box's own text. These
              strips stay out of the box's actual content area entirely —
              hovering near an edge shows the move cursor, hovering
              anywhere else behaves like plain text. Available regardless
              of selection state (same as any editor's "hover the edge to
              move" affordance); only the resize handles below are gated on
              isSelected. */}
          <div
            onPointerDown={handleMovePointerDown}
            title={`Drag to move ${fieldKey}`}
            className="absolute inset-x-0 top-0 z-20 cursor-move"
            style={{ height: MOVE_BAND_PX }}
          />
          <div
            onPointerDown={handleMovePointerDown}
            title={`Drag to move ${fieldKey}`}
            className="absolute inset-x-0 bottom-0 z-20 cursor-move"
            style={{ height: MOVE_BAND_PX }}
          />
          <div
            onPointerDown={handleMovePointerDown}
            title={`Drag to move ${fieldKey}`}
            className="absolute left-0 z-20 cursor-move"
            style={{ top: MOVE_BAND_PX, bottom: MOVE_BAND_PX, width: MOVE_BAND_PX }}
          />
          <div
            onPointerDown={handleMovePointerDown}
            title={`Drag to move ${fieldKey}`}
            className="absolute right-0 z-20 cursor-move"
            style={{ top: MOVE_BAND_PX, bottom: MOVE_BAND_PX, width: MOVE_BAND_PX }}
          />

          {isSelected &&
            HANDLES.map(({ dir, style, cursor }) => (
              <div
                key={dir}
                onPointerDown={(e) => handleResizePointerDown(dir, e)}
                className="absolute z-20 h-2.5 w-2.5 rounded-sm border border-white bg-primary shadow-sm"
                style={{ ...style, cursor }}
              />
            ))}
        </>
      )}
    </div>
  );
}
