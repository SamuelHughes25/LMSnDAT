"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ImageIcon, Pencil, Trash2, Type } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { Slide, SlideConfig, SlideObjectRef } from "@/lib/course-types";
import { normalizeObjectOrder } from "@/lib/course-types";
import { cn } from "@/lib/utils";
import { useSlideSelection } from "./slide-selection-context";

function refKey(ref: SlideObjectRef): string {
  return `${ref.type}:${ref.id}`;
}

// True iff both lists contain exactly the same set of refs (ignoring
// order) — used below to tell "this is still the same stack, maybe just
// reordered by us" apart from "something else added/removed an object."
function sameRefSet(a: SlideObjectRef[], b: SlideObjectRef[]): boolean {
  if (a.length !== b.length) return false;
  const bKeys = new Set(b.map(refKey));
  return a.every((r) => bKeys.has(refKey(r)));
}

// Photoshop-style object list for a freeform content slide — every
// text_boxes[]/extra_images[] entry, in `object_order` (index 0 = back,
// last = front — see course-types.ts's own comment on why that array IS
// the stacking order, no separate z-index field). Rendered reversed here
// (front-most row at top), matching the reference point the feature was
// asked for. The single background image, if set, gets its own row above
// the list — selectable (click to edit it, same as any other object) but
// deliberately not reorderable: see SlideObjectRef's own comment on why it
// stays a non-stackable backdrop for this pass.
export function SlideLayersPanel({
  slide,
  onConfigChange,
}: {
  slide: Slide;
  onConfigChange: (config: Partial<SlideConfig>) => void;
}) {
  const { selectedId, select, deselect } = useSlideSelection();
  const textBoxes = slide.config.text_boxes ?? [];
  const extraImages = slide.config.extra_images ?? [];
  const hasBackground = !!slide.config.background_image_url;
  // normalizeObjectOrder, not a bare `slide.config.object_order ?? []` —
  // see its own comment in course-types.ts: this is what makes an
  // extra_images entry that's missing from object_order (the actual
  // root cause behind "the layers panel only ever showed one image")
  // show up here instead of silently never appearing.
  const order = normalizeObjectOrder(slide.config);

  // `order` above (straight off the `slide` prop) is what gets RENDERED —
  // fine, since it's only ever a few ms stale. But moveInOrder/deleteRef
  // can't compute their NEXT array from it: confirmed in a real browser,
  // two reorder clicks fired close together (well within one React
  // render/commit — ordinary fast repeat-clicking, not a contrived race)
  // both land in a render where `slide` still reflects the PRE-either-
  // click prop, so both compute the exact same swap from the exact same
  // starting point — the second click's onConfigChange call then
  // overwrites the first click's result with an IDENTICAL object_order,
  // net effect nothing visibly happens after the first click. Same root
  // cause, and same fix, as course-builder.tsx's handleSlideConfigChange
  // already had to apply for config merging in general (see its own
  // extensive comment): a ref, read and written eagerly inside the event
  // handler itself (never during render — that's the one thing refs
  // can't be used for, see React's rules on this), is the only way a
  // second click milliseconds later can see the first click's result
  // with zero dependency on React's render timing. Synced from the prop
  // in an effect (post-commit, not render) whenever the actual SET of
  // objects changes — e.g. the canvas's "Add text box" flow adding an
  // item while this panel is open; nothing other than this component's
  // own moveInOrder/deleteRef ever reorders or shrinks object_order, so
  // a same-set prop is always just our own pending write catching up.
  const orderRef = useRef<SlideObjectRef[]>(order);
  useEffect(() => {
    const latest = normalizeObjectOrder(slide.config);
    if (!sameRefSet(orderRef.current, latest)) {
      orderRef.current = latest;
    }
  }, [slide.config]);

  // FLIP animation (First/Last/Invert/Play) for the row list below — a
  // click just silently re-rendering the rows in their new order left it
  // ambiguous which row actually moved where relative to the others,
  // reported back directly as a real gap even once reordering itself
  // started working correctly. rowElsRef holds every currently-mounted
  // row's DOM node, keyed by refKey (registered via each row's own ref
  // callback below); prevRectsRef holds where each one was measured as
  // sitting the LAST time this effect ran. On every reorder: measure
  // where everything is NOW (after the DOM already reflects the new
  // order), diff against where it was, and for anything that moved,
  // snap it back to its old position with a transform (no visible jump,
  // since this happens in the same paint via useLayoutEffect) then
  // release that transform on the next frame so it visibly slides from
  // old to new. Pure layout animation — no extra library, nothing else
  // about the component's behavior changes.
  const rowElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());

  function registerRowEl(key: string, el: HTMLDivElement | null) {
    if (el) rowElsRef.current.set(key, el);
    else rowElsRef.current.delete(key);
  }

  function refName(ref: SlideObjectRef, index: number): string {
    if (ref.type === "text") {
      const box = textBoxes.find((b) => b.id === ref.id);
      return box?.name || `Text ${index + 1}`;
    }
    const image = extraImages.find((i) => i.id === ref.id);
    return image?.name || `Image ${index + 1}`;
  }

  function selectionIdFor(ref: SlideObjectRef): string {
    return ref.type === "text" ? `${slide.id}:text:${ref.id}` : `${slide.id}:extra-image:${ref.id}`;
  }

  function renameRef(ref: SlideObjectRef, name: string) {
    if (ref.type === "text") {
      onConfigChange({ text_boxes: textBoxes.map((b) => (b.id === ref.id ? { ...b, name } : b)) });
    } else {
      onConfigChange({ extra_images: extraImages.map((i) => (i.id === ref.id ? { ...i, name } : i)) });
    }
  }

  function deleteRef(ref: SlideObjectRef) {
    // Found during a review pass: deleting a ref that's currently SELECTED
    // used to leave selectedId pointing at an id nothing resolves to any
    // more — FreeTextBoxProperties/ImageObjectProperties both already
    // guard against rendering a deleted object (an early `if (!box) return
    // null`/`if (!image) return null`), so this never crashed, but it did
    // leave the properties panel just silently blank until the author
    // clicked something else. Deselecting here falls it back to the
    // normal slide view instead. deselect() (not a bare select(null)) only
    // clears the slot if THIS ref is still the one selected — otherwise a
    // delete on a row that ISN'T selected would wrongly clobber whatever
    // actually is.
    deselect(selectionIdFor(ref));
    const nextOrder = orderRef.current.filter((r) => !(r.type === ref.type && r.id === ref.id));
    orderRef.current = nextOrder;
    if (ref.type === "text") {
      onConfigChange({ text_boxes: textBoxes.filter((b) => b.id !== ref.id), object_order: nextOrder });
    } else {
      onConfigChange({ extra_images: extraImages.filter((i) => i.id !== ref.id), object_order: nextOrder });
    }
  }

  // Looks up `ref`'s CURRENT position in `orderRef.current` itself,
  // rather than trusting an index captured back when the row was
  // rendered — that index can go stale the instant a previous rapid
  // click has already shifted things around underneath it. Resolving by
  // identity here means every click, however rapidly they're fired,
  // always operates on the real up-to-the-millisecond stack.
  function moveInOrder(ref: SlideObjectRef, direction: "up" | "down") {
    const current = orderRef.current;
    const index = current.findIndex((r) => r.type === ref.type && r.id === ref.id);
    if (index === -1) return;
    const targetIndex = direction === "up" ? index + 1 : index - 1;
    if (targetIndex < 0 || targetIndex >= current.length) return;
    const next = [...current];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    orderRef.current = next;
    onConfigChange({ object_order: next });
  }

  // Reversed for display (front-most first); each row's underlying
  // `order` index is `order.length - 1 - displayIndex`, needed for the
  // up/down handlers above. Computed (and the FLIP effect below hooked
  // up) BEFORE the early-return just below, not after it — every hook in
  // this component, this one included, has to run unconditionally on
  // every render regardless of whether that return ends up taken.
  const displayRows = [...order].reverse();
  // Changes exactly when a row's POSITION in the list could have changed
  // (add/remove/reorder) — not on every render (e.g. typing a rename),
  // which would otherwise fire the FLIP measurement for a list that
  // never actually moved.
  const orderFingerprint = displayRows.map(refKey).join("|");

  useLayoutEffect(() => {
    const prevRects = prevRectsRef.current;
    const nextRects = new Map<string, DOMRect>();
    rowElsRef.current.forEach((el, key) => nextRects.set(key, el.getBoundingClientRect()));
    nextRects.forEach((rect, key) => {
      const prevRect = prevRects.get(key);
      const el = rowElsRef.current.get(key);
      if (!prevRect || !el) return;
      const deltaY = prevRect.top - rect.top;
      if (Math.abs(deltaY) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${deltaY}px)`;
      // Forces the browser to apply the transform above in this paint
      // before the transform is released below — without this read, the
      // two style writes could get batched into one and never actually
      // render the "start" position, which is the whole animation.
      el.getBoundingClientRect();
      requestAnimationFrame(() => {
        el.style.transition = "transform 180ms ease";
        el.style.transform = "";
      });
    });
    prevRectsRef.current = nextRects;
  }, [orderFingerprint]);

  if (order.length === 0 && !hasBackground) {
    return (
      <div className="space-y-1.5">
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Layers</div>
        <p className="text-xs text-muted-foreground">
          Nothing on this slide yet — add a text box or an image to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Layers</div>
      <div className="space-y-1">
        {displayRows.map((ref, displayIndex) => {
          const orderIndex = order.length - 1 - displayIndex;
          const key = refKey(ref);
          return (
            <div key={key} ref={(el) => registerRowEl(key, el)}>
              <LayerRow
                icon={ref.type === "text" ? Type : ImageIcon}
                name={refName(ref, orderIndex)}
                selected={selectedId === selectionIdFor(ref)}
                onSelect={() => select(selectionIdFor(ref))}
                onRename={(name) => renameRef(ref, name)}
                onDelete={() => deleteRef(ref)}
                onMoveUp={displayIndex > 0 ? () => moveInOrder(ref, "up") : undefined}
                onMoveDown={displayIndex < displayRows.length - 1 ? () => moveInOrder(ref, "down") : undefined}
              />
            </div>
          );
        })}
        {hasBackground && (
          <LayerRow
            icon={ImageIcon}
            name="Background image"
            selected={selectedId === `${slide.id}:background-image`}
            onSelect={() => select(`${slide.id}:background-image`)}
            // Background stays non-reorderable and non-renameable — it's a
            // backdrop, not a stackable object, see this file's top comment.
          />
        )}
      </div>
    </div>
  );
}

function LayerRow({
  icon: Icon,
  name,
  selected,
  onSelect,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  icon: typeof Type;
  name: string;
  selected: boolean;
  onSelect: () => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  function commitRename() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onRename?.(trimmed);
    else setDraft(name);
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs transition-colors",
        selected ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraft(name);
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-6 px-1 text-xs"
          />
        ) : (
          <span className="truncate">{name}</span>
        )}
      </button>
      {onRename && !editing && (
        <button
          type="button"
          aria-label={`Rename ${name}`}
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          className="shrink-0 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
      {(onMoveUp || onMoveDown) && (
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            aria-label="Move layer up"
            disabled={!onMoveUp}
            onClick={onMoveUp}
            className="text-muted-foreground hover:text-foreground disabled:opacity-20"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label="Move layer down"
            disabled={!onMoveDown}
            onClick={onMoveDown}
            className="text-muted-foreground hover:text-foreground disabled:opacity-20"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      )}
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete ${name}`}
          onClick={onDelete}
          className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
