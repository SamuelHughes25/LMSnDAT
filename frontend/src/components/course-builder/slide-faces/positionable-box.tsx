"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { BoxTransform } from "@/lib/course-types";
import { cn } from "@/lib/utils";
import { useActiveEditorContext } from "../active-editor-context";
import { CANVAS_H, CANVAS_W } from "../slide-canvas";
import { useSlideSelection } from "../slide-selection-context";
import { useSnapGuides } from "../snap-guide-context";
import { HANDLES, type HandleDir, clampPositionPct } from "./image-shared";
import type { SlideFaceProps } from "./index";
import { snapBoxPosition, snapEdge } from "./snap-guides";

// Width of the invisible "grab to move" band just inside the box's own
// edges — see the perimeter strips below.
const MOVE_BAND_PX = 10;

// Minimum pointer travel (px) before a move/resize gesture counts as an
// actual drag rather than a plain click. Without this, a PLAIN CLICK on
// the move band or a resize handle — pointerdown immediately followed by
// pointerup with zero movement, which is exactly what happens when a user
// clicks a box just to SELECT it — still ran the full onUp -> commit ->
// onTransform path with a same-as-start value, silently converting an
// untouched, flex-rendered box into an absolutely-positioned one at its
// current spot. That matters because position:absolute takes an element
// OUT of the flex column entirely: confirmed via a real browser that
// clicking title's move band (selecting it, no drag intended) shrank the
// flex column by title's own ~40px height, so body — still flex-rendered,
// stacked below title — visibly jumped up to fill the space title used to
// reserve, reported as "the text box position jumps up to the bottom of
// the title box" the moment the title (not even the text box itself) was
// merely clicked. A few pixels of slop is standard for distinguishing a
// click from a drag in any pointer-driven editor; small enough that no
// deliberate drag is ever mistaken for a click.
const DRAG_THRESHOLD_PX = 3;

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
  zIndex,
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
  // Explicit stacking order, set only by freeform-content-slide.tsx (one
  // object_order entry's own index) — see BackgroundImagePixels' matching
  // prop/comment in background-image-field.tsx for the bug this fixes.
  // Every other (legacy, box_transforms-based) caller leaves this unset and
  // keeps the z-10/z-30 scheme below exactly as before — that scheme solves
  // a different problem (an untransformed flex sibling vs. a dragged one)
  // with no "stacking order" array of its own to defer to.
  zIndex?: number;
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
  // blur-out, guarded against the properties panel the same way
  // RichTextBody's own onBlur is (see content-slide-face.tsx) — otherwise
  // clicking a Bold/Italic button in the panel's own formatting controls
  // would look like focus left the box and hide its handles mid-format.
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
  const { panelRef, panelInteractingRef, panelPointerDownRef, activeEditor, activeEditorId } = useActiveEditorContext();
  const { setGuides, clearGuides } = useSnapGuides();

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

  // A second, independent deselect path alongside handleBlur below — NOT a
  // replacement for it (that one still matters for keyboard-driven focus
  // changes, e.g. Tab, which involve no pointerdown at all), but the one
  // that actually fires reliably for clicking away with a pointer. Mirrors
  // BackgroundImageEditLayer's own handlePointerDownOutside in
  // background-image-field.tsx exactly, for the same reason that one was
  // built pointerdown-first instead of blur-first: blur only ever fires
  // when something that currently HAS focus loses it, but clicking inert,
  // non-focusable panel content (plain text, headings, padding) already
  // blurs this box's editor via the browser's own default behavior WITHOUT
  // moving focus anywhere else — and panelPointerDownRef (see
  // active-editor-context.tsx) deliberately suppresses handleBlur's
  // deselect for exactly that click, so the box's text editing correctly
  // continues to feel "still selected." The gap that leaves: once that
  // native blur has already happened, nothing is focused anymore, so NO
  // later click — anywhere, panel or canvas — ever produces another blur
  // event for this box to react to. `selectedId` is then permanently
  // orphaned at this box's id until the user clicks back into it and away
  // again, re-arming a real focus/blur pair. Confirmed as a real,
  // reported bug: click a text box, click blank panel space (not a
  // control), and every subsequent click anywhere stopped unselecting it.
  // A capture-phase pointerdown listener has no such dependency — it fires
  // for literally every click, focus or no focus, so it can't get
  // orphaned the same way. Declared here (before the mode !== "edit" early
  // return just below) because every hook in this component has to run
  // unconditionally on every render, same reasoning as the layout effect
  // just above.
  //
  // Also checks panelInteractingRef, same as handleBlur above — a real
  // regression caught immediately after this effect first shipped: the
  // panel's font-SIZE control (and the color picker) open straight into a
  // PORTAL-rendered listbox/menu outside panelRef's own DOM subtree (see
  // active-editor-context.tsx's panelPointerDownRef comment, and
  // content-slide-face.tsx's identical note on its own onBlur guard, for
  // the fuller story), so clicking an actual size option landed outside
  // BOTH `wrapper` and `panel` by this check's reckoning — deselecting the
  // box mid-click, before the size change could even register. Every panel
  // control that manages its own portal already sets this ref directly
  // while open (text-formatting-controls.tsx), which is the one signal
  // that's accurate regardless of where in the DOM the portal landed.
  useEffect(() => {
    if (mode !== "edit" || !isSelected) return;
    function handlePointerDownOutside(e: PointerEvent) {
      if (panelInteractingRef.current) return;
      const wrapper = wrapperRef.current;
      const panel = panelRef.current;
      if (!(e.target instanceof Node)) return;
      if (panel && panel.contains(e.target)) return;
      if (wrapper && !wrapper.contains(e.target)) {
        deselect(selectionId);
      }
    }
    document.addEventListener("pointerdown", handlePointerDownOutside, true);
    return () => document.removeEventListener("pointerdown", handlePointerDownOutside, true);
  }, [mode, isSelected, deselect, selectionId, panelRef, panelInteractingRef]);

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
    // An untouched (never dragged/resized) box has no transform to render
    // absolutely-positioned — it's supposed to fall back to plain flex
    // layout, same as the edit-mode branch below does for its own
    // untransformed case (`!isPositioned && flexClassName`). Returning the
    // bare children here (no wrapper at all, as this used to do) discarded
    // `flexClassName` entirely instead of falling back to it — invisible
    // for fields like title, whose flexClassName is undefined (nothing to
    // lose), but a real, confirmed bug for content-slide-face.tsx's body
    // field, whose flexClassName ("mt-8 min-h-0 flex-1") is load-bearing:
    // without flex-1, body stopped growing to fill the slide's remaining
    // height and rendered via whatever fallback sizing its own h-full
    // className resolved to instead — reproduced via a real browser
    // (measuring computed styles) landing body's text at exactly 50% of
    // the slide's height in both the thumbnail and the published preview,
    // vs. its correct ~22% right below the title in the builder's edit
    // canvas, which — unlike present/static — always went through the
    // *other* branch below and so never dropped these classes. Matching
    // edit mode's own wrapper shape (a plain div carrying flexClassName)
    // fixes this without touching the transformed-box branch below at all.
    if (!transform) return <div className={cn("relative", flexClassName)}>{children}</div>;
    // z-10 for the same reason as the edit-mode return below: a
    // transformed box can visually overlap an untransformed sibling still
    // in normal flex flow, and without an explicit stacking order they'd
    // fall back to DOM order, which isn't necessarily what was intended.
    // overflow-hidden lives on the INNER wrapper (around just the
    // content), not this outer positioned box — see the identical note on
    // the edit-mode return below for why that split matters. `zIndex`
    // (freeform callers only) overrides the z-10 default — see this
    // component's own prop comment.
    return (
      <div
        className={cn("absolute", zIndex == null && "z-10")}
        style={{
          ...topLeftBoxStyle(transform.xPct, transform.yPct, transform.widthPct, transform.heightPct),
          ...(zIndex != null ? { zIndex } : {}),
        }}
      >
        <div className="h-full w-full overflow-hidden">{children}</div>
      </div>
    );
  }

  const baseline = transform ?? measuredBaseline;

  function commit(next: BoxTransform) {
    setLive(null);
    onTransform(next);
  }

  // The move band and resize handles both preventDefault() on pointerdown
  // (see handleMovePointerDown's own comment on why), which as a side
  // effect suppresses the native blur that would otherwise fire on
  // whichever OTHER box's editor currently has real DOM focus — select()
  // below updates the shared SELECTION slot just fine regardless, but
  // without this, that other editor's own onBlur (and the
  // active-editor-context cleanup it drives) never runs at all. Confirmed
  // as a real, reported bug: clicking box B's move band while box A's text
  // was focused moved the border/selection outline to B, but the actual
  // text CURSOR silently stayed in A — typing kept landing in A even
  // though it no longer looked selected. Only relevant when the
  // previously-active editor belongs to a DIFFERENT box than the one being
  // selected now — grabbing a box's own move band while ITS OWN text is
  // already focused must never blur it out from under the user.
  function blurStaleEditor() {
    if (activeEditor && activeEditorId && activeEditorId !== selectionId) {
      activeEditor.commands.blur();
    }
  }

  function handleMovePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    select(selectionId);
    blurStaleEditor();
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
    // See DRAG_THRESHOLD_PX's comment: a plain click (no real movement)
    // must select without also committing `start` right back as a "new"
    // transform, which would silently pull the box out of flex flow.
    let moved = false;

    function onMove(moveEvent: PointerEvent) {
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      moved = true;
      const rawX = clampPositionPct(start.xPct + ((moveEvent.clientX - startX) / rect.width) * 100);
      const rawY = clampPositionPct(start.yPct + ((moveEvent.clientY - startY) / rect.height) * 100);
      // Snap by whichever of this box's own left/right/center edges lands
      // closest to a milestone — see snapBoxPosition's own comment for why
      // a top-left-anchored box needs all three checked, not just its
      // literal (x, y) anchor point the way a center-anchored image does.
      const snappedX = snapBoxPosition(rawX, start.widthPct, CANVAS_W);
      const snappedY = snapBoxPosition(rawY, start.heightPct, CANVAS_H);
      setGuides({
        vertical: snappedX.guide !== null ? [snappedX.guide] : [],
        horizontal: snappedY.guide !== null ? [snappedY.guide] : [],
      });
      current = { ...start, xPct: snappedX.pos, yPct: snappedY.pos };
      setLive(current);
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      clearGuides();
      if (moved) commit(current);
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
    blurStaleEditor();
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
    // See DRAG_THRESHOLD_PX's comment on handleMovePointerDown — the same
    // "plain click shouldn't commit a same-as-start transform" reasoning
    // applies here too.
    let moved = false;

    function onMove(moveEvent: PointerEvent) {
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      moved = true;
      const dxPct = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dyPct = ((moveEvent.clientY - startY) / rect.height) * 100;
      let { xPct, yPct, widthPct, heightPct } = start;
      const vertical: number[] = [];
      const horizontal: number[] = [];

      // Snap whichever edge THIS handle is actually moving — the opposite
      // edge is the fixed anchor (see this function's own opening comment),
      // so only the moving one is a meaningful snap target here (unlike a
      // whole-box MOVE, which checks all three of left/right/center — see
      // handleMovePointerDown above).
      if (dir.includes("e")) {
        widthPct = clampTextSizePct(start.widthPct + dxPct);
        const snapped = snapEdge(xPct + widthPct, CANVAS_W);
        if (snapped.guide !== null) {
          widthPct = clampTextSizePct(snapped.value - xPct);
          vertical.push(snapped.guide);
        }
      }
      if (dir.includes("w")) {
        widthPct = clampTextSizePct(start.widthPct - dxPct);
        xPct = rightAnchor - widthPct;
        const snapped = snapEdge(xPct, CANVAS_W);
        if (snapped.guide !== null) {
          xPct = snapped.value;
          widthPct = clampTextSizePct(rightAnchor - xPct);
          vertical.push(snapped.guide);
        }
      }
      if (dir.includes("s")) {
        heightPct = clampTextSizePct(start.heightPct + dyPct);
        const snapped = snapEdge(yPct + heightPct, CANVAS_H);
        if (snapped.guide !== null) {
          heightPct = clampTextSizePct(snapped.value - yPct);
          horizontal.push(snapped.guide);
        }
      }
      if (dir.includes("n")) {
        heightPct = clampTextSizePct(start.heightPct - dyPct);
        yPct = bottomAnchor - heightPct;
        const snapped = snapEdge(yPct, CANVAS_H);
        if (snapped.guide !== null) {
          yPct = snapped.value;
          heightPct = clampTextSizePct(bottomAnchor - yPct);
          horizontal.push(snapped.guide);
        }
      }

      setGuides({ vertical, horizontal });
      current = { xPct, yPct, widthPct, heightPct };
      setLive(current);
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      clearGuides();
      if (moved) commit(current);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function handleFocus() {
    select(selectionId);
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    const nextFocus = e.relatedTarget;
    const panelEl = panelRef.current;
    const focusMovedIntoPanel = !!(panelEl && nextFocus instanceof Node && panelEl.contains(nextFocus));
    const focusStayedInBox = !!(nextFocus && e.currentTarget.contains(nextFocus as Node));
    if (focusMovedIntoPanel || panelInteractingRef.current || panelPointerDownRef.current || focusStayedInBox) {
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
      //
      // `zIndex` (freeform callers only — see this component's own prop
      // comment) overrides the z-10/z-30 scheme with an explicit value
      // instead, but the "selected jumps to front" behavior still applies:
      // 1000 is comfortably above any plausible object_order-derived value
      // (a handful of objects on one slide), so the selected box still
      // visibly wins every overlap regardless of its own stacking index.
      className={cn(
        "relative",
        !isPositioned && flexClassName,
        isPositioned && "absolute",
        isPositioned && zIndex == null && (isSelected ? "z-30" : "z-10"),
      )}
      style={
        isPositioned && effective
          ? {
              ...topLeftBoxStyle(effective.xPct, effective.yPct, effective.widthPct, effective.heightPct),
              ...(zIndex != null ? { zIndex: isSelected ? 1000 : zIndex } : {}),
            }
          : undefined
      }
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
          to own it.

          The border itself only renders once selected — rendering it at
          all times (an earlier version of this, meant as a boundary hint
          for an otherwise invisible box) was reported as visual clutter:
          every box on a slide showed a permanent faint outline regardless
          of whether it was actually being worked on, competing with the
          slide's own content. Selected-only matches the resize handles/
          z-index treatment above — border, handles, and front-of-stack
          z-index all now turn on together as one "this is the thing I'm
          editing" signal, off together otherwise. This whole branch only
          runs in edit mode (mode !== "edit" returns early, well above), so
          no extra mode check is needed here. */}
      <div
        className={cn(
          "h-full w-full overflow-hidden border",
          isSelected ? "border-primary/70" : "border-transparent",
        )}
      >
        {children}
      </div>

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
