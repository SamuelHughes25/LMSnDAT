"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { restrictToHorizontalAxis, restrictToParentElement } from "@/lib/dnd-modifiers";
import { useIsClient } from "@/lib/use-is-client";

export type AnalyticsStat = {
  id: string;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
};

// Per-browser only — see this component's own top-of-file comment. Not
// scoped per course: this is "which stat do I personally like to see
// first," the same preference regardless of which course's analytics the
// user happens to be looking at.
const STORAGE_KEY = "lms-analytics-stat-order";

// Matches StatCard's own w-60 + the track's gap-4 below — kept as named
// constants so the arrow buttons scroll by exactly one card+gap rather
// than a guessed pixel amount that could drift out of sync with the class
// names if either changes. 240 (was 208) — one card (Average score) moved
// out of this row entirely (see analytics/page.tsx's own comment on why),
// and the freed-up width went into making the remaining cards a bit
// bigger rather than just shrinking the slider's own footprint.
const CARD_WIDTH = 240;
const CARD_GAP = 16;
const SCROLL_STEP = CARD_WIDTH + CARD_GAP;

// How wide the edge fade (see the track's maskImage below) is, in px.
const FADE_WIDTH = 24;

function readStoredOrder(): string[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredOrder(order: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Best-effort — private browsing/a full storage quota shouldn't break
    // reordering itself, just its persistence across reloads.
  }
}

// Plain borderless chevron, not the shared Button component — Button's
// fixed icon-size variants (size-6/7/8/9) fight any attempt to give this a
// generous, non-square hit area, and its outline/ghost variants both carry
// visible chrome (a border or a hover background box) this control is
// deliberately NOT meant to have: just the glyph itself.
//
// A genuine flex sibling of the track (own reserved column — see the
// render below), not an overlay on top of it: overlaying it directly on
// the leading/trailing card looked right at the resting scroll position
// but still covered whatever card was scrolled under it mid-drag/mid-
// animation, and reportedly made the edge cards "essentially useless" to
// read. A dedicated (if narrow) column means it never shares space with
// card content at any scroll position, not just the resting ones.
// w-9 h-full (not a small centered square) is what makes the CLICKABLE
// area generous despite the glyph itself staying small — a full-height
// strip is easy to land a click on without needing pixel precision, even
// though almost none of it is visually "there."
function SliderArrowButton({ direction, onClick }: { direction: "left" | "right"; onClick: () => void }) {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={direction === "left" ? "Scroll stats left" : "Scroll stats right"}
      onClick={onClick}
      className="flex h-auto w-9 shrink-0 items-center justify-center self-stretch text-muted-foreground/60 outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

function StatCard({ stat }: { stat: AnalyticsStat }) {
  // No separate drag handle (unlike slide-rail.tsx's lesson rows) — these
  // cards have no other interactive content inside them to conflict with
  // {...listeners}, so the whole card is grabbable, same as
  // slide-thumbnail.tsx's own whole-card drag.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stat.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="w-60 shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
    >
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{stat.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="truncate text-2xl font-semibold">{stat.value}</div>
        {stat.detail !== undefined && <div className="mt-0.5 truncate text-xs text-muted-foreground">{stat.detail}</div>}
      </CardContent>
    </Card>
  );
}

// A non-interactive, non-sortable duplicate of a real StatCard — pure
// scroll filler. AnalyticsStatSlider renders one full copy of these before
// the real (sortable) cards and one full copy after them, so the track has
// genuinely identical content to scroll into just past the real set's own
// start/end — that's what makes the loop jump in useLoopingScroll below
// imperceptible: whatever card sits at the viewport edge right before the
// jump is bit-for-bit the same one that's there right after. aria-hidden
// since a screen reader already encounters this exact stat via its real,
// sortable copy.
function StatCardStatic({ stat }: { stat: AnalyticsStat }) {
  return (
    <Card aria-hidden className="w-60 shrink-0 select-none">
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{stat.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="truncate text-2xl font-semibold">{stat.value}</div>
        {stat.detail !== undefined && <div className="mt-0.5 truncate text-xs text-muted-foreground">{stat.detail}</div>}
      </CardContent>
    </Card>
  );
}

// A horizontally-scrolling, user-reorderable strip of the course Analytics
// tab's top-line stat cards. "Slider" here means a left/right-nudged strip
// (native scroll-snap, pushed by the two arrow buttons) — not a single-
// card-at-a-time carousel, so every card stays reachable by a normal
// trackpad/touch swipe too, the buttons are just a convenience.
//
// Card order is a pure per-browser preference (localStorage, keyed by
// stat id — never sent to the server, never shared) — one manager
// rearranging their own view never changes what a colleague sees looking
// at the exact same course, which is the whole point of keeping this out
// of any shared/server-persisted state.
//
// While dragging, restrictToHorizontalAxis + restrictToParentElement (see
// lib/dnd-modifiers.ts — the same pair slide-rail.tsx uses, just axis-
// swapped) clamp the dragged card's own visual position to the track,
// moving left/right only, regardless of where the pointer actually is —
// the card can never be "picked up" off the slider the way a free
// transform:translate(pointerX, pointerY) would let it.
export function AnalyticsStatSlider({ stats }: { stats: AnalyticsStat[] }) {
  // Server-rendered (and the client's very first paint, before hydration)
  // always show the natural prop order — there's no meaningful "server"
  // localStorage value — then the real stored order is applied by
  // adjusting state during render once isClient flips true, same
  // sanctioned "alternative to setState-in-an-effect" pattern
  // theme-toggle.tsx/use-view-mode.ts already use for their own
  // localStorage-backed preferences. `useIsClient` is what makes this safe
  // against a hydration mismatch.
  const isClient = useIsClient();
  const [order, setOrder] = useState<string[]>(() => stats.map((s) => s.id));
  const [appliedStatIdsKey, setAppliedStatIdsKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Wraps only the real (sortable) cards — a separate ref from scrollRef
  // specifically so its measured width (one full "lap" of the real set)
  // is what the loop math below jumps by, independent of however many
  // static clone copies happen to be rendered alongside it.
  const middleRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const statIdsKey = stats.map((s) => s.id).join(",");

  // Reconciles the server-computed stat SET (can genuinely differ per
  // course — e.g. the most-failed/most-passed-question cards only exist
  // once someone's answered a gradable question) against whatever order
  // was saved previously: known ids keep the saved order, any id not in
  // the saved list (new to this course, or a brand new stat added later)
  // is appended at the end rather than silently dropped. Re-applies
  // whenever the actual SET of available stats changes — e.g. navigating
  // to a different course's analytics tab, which re-renders this same
  // client component with new props rather than unmounting it.
  if (isClient && appliedStatIdsKey !== statIdsKey) {
    setAppliedStatIdsKey(statIdsKey);
    const availableIds = stats.map((s) => s.id);
    const stored = readStoredOrder();
    if (stored) {
      const known = stored.filter((id) => availableIds.includes(id));
      const missing = availableIds.filter((id) => !known.includes(id));
      setOrder([...known, ...missing]);
    } else {
      setOrder(availableIds);
    }
  }

  const statsById = Object.fromEntries(stats.map((s) => [s.id, s]));
  const orderedStats = order.map((id) => statsById[id]).filter((s): s is AnalyticsStat => s !== undefined);

  // Whether the real cards alone are wider than the track's own viewport —
  // i.e. whether there's actually anything to loop. A course with few
  // enough stats to show them all at once needs no clones and no wrap: the
  // track just behaves like a plain, non-scrolling row, same as before this
  // change.
  const [needsLoop, setNeedsLoop] = useState(false);

  // Measures the real (middle) set's width against the track's own visible
  // width — re-measures whenever the actual set of cards changes
  // (statIdsKey) or the track/middle section resizes (sidebar toggle,
  // window resize, etc). Deliberately does NOT reset scrollLeft here on
  // every resize — only the separate effect below does that, and only once
  // per statIdsKey — so resizing the window later never yanks the viewer's
  // current scroll position back to centre out from under them.
  useEffect(() => {
    const el = scrollRef.current;
    const middle = middleRef.current;
    if (!el || !middle) return;
    function update() {
      if (!el || !middle) return;
      setNeedsLoop(middle.getBoundingClientRect().width > el.clientWidth + 1);
    }
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    observer.observe(middle);
    return () => observer.disconnect();
  }, [statIdsKey]);

  // The actual infinite-loop illusion: once looping is active, AnalyticsStatSlider
  // renders [clone copy][real copy][clone copy] back to back (see the render
  // below). This effect parks the resting scroll position at the start of
  // the real (middle) copy as soon as those clones exist in the DOM (i.e.
  // once needsLoop just turned true — React only runs this AFTER the
  // matching render has committed, so the clones are already there by the
  // time `middle.getBoundingClientRect()` is read), then on every scroll
  // event checks whether the viewer has scrolled far enough into either
  // clone copy to be approaching its own edge, and silently teleports them
  // back by exactly one real copy's width — imperceptible, since the
  // content at that exact scroll position is identical before and after
  // the jump.
  useEffect(() => {
    if (!needsLoop) return;
    const el = scrollRef.current;
    const middle = middleRef.current;
    if (!el || !middle) return;
    el.scrollLeft = middle.getBoundingClientRect().width;
    function handleScroll() {
      if (!el || !middle) return;
      const middleWidth = middle.getBoundingClientRect().width;
      if (middleWidth <= 0) return;
      if (el.scrollLeft < middleWidth * 0.5) {
        el.scrollLeft += middleWidth;
      } else if (el.scrollLeft > middleWidth * 1.5) {
        el.scrollLeft -= middleWidth;
      }
    }
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [needsLoop, statIdsKey]);

  // Infinite scroll means there's always more in both directions, so
  // unlike the old "only fade an edge that genuinely has more past it"
  // version, both edges fade permanently once looping — and neither does
  // when it isn't (nothing to loop into, same plain-row look as before).
  const maskImage = needsLoop
    ? `linear-gradient(to right, transparent, black ${FADE_WIDTH}px, black calc(100% - ${FADE_WIDTH}px), transparent)`
    : undefined;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((current) => {
      const oldIndex = current.indexOf(String(active.id));
      const newIndex = current.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return current;
      const next = arrayMove(current, oldIndex, newIndex);
      writeStoredOrder(next);
      return next;
    });
  }

  return (
    // Plain flex row — left arrow, track, right arrow, each a genuine
    // sibling with its own space, not an overlay. Reserving a narrow (w-9)
    // column per arrow does inset the first card slightly from the page's
    // own left margin (the earlier flush-aligned version avoided exactly
    // this), but that's the deliberate trade for the arrows never
    // overlapping a card at any scroll position — asked for directly,
    // after both the overlap-on-hover and overlap-always versions got
    // reported as covering up the leading/trailing card's own text.
    <div className="flex min-w-0 items-stretch gap-1">
      <SliderArrowButton
        direction="left"
        onClick={() => scrollRef.current?.scrollBy({ left: -SCROLL_STEP, behavior: "smooth" })}
      />
      {/* min-w-0 is required here — a flex item defaults to min-width:auto,
          which lets this div's own intrinsic content width (all the
          fixed-width cards laid out in a row, un-shrunk) win over its
          ancestors' own "fill remaining space" sizing and push content off
          the page entirely instead of actually scrolling internally. Same
          root cause, same fix, as the permission-set dialog's tab-strip
          overflow earlier this project (see ui/tabs.tsx's own comment), and
          as app-shell.tsx's own main-column fix right above this
          component's own.

          This is the only actual scroll container — pulled OUTSIDE
          DndContext/SortableContext (unlike before this change) because it
          now also holds the two static clone copies (see StatCardStatic's
          own comment) that make the infinite loop work, and those aren't
          sortable items at all. */}
      <div
        ref={scrollRef}
        style={{ maskImage, WebkitMaskImage: maskImage, overflowAnchor: "none" }}
            // overflowAnchor: "none" — defensive; doesn't by itself fix the
            // issue below, but there's no reason to leave scroll anchoring
            // on for a track whose content gets reordered programmatically
            // (not something a viewer is mid-read through), so it stays
            // off regardless.
            //
            // No scroll-snap here (an earlier version had snap-x on this
            // div and snap-start on each card) — that turned out to be the
            // REAL cause of the resting scroll position looking wrong,
            // confirmed by direct measurement: applying a stored custom
            // order moves these cards' real DOM nodes (same keys, new
            // positions) a tick after the track first mounts, and with
            // scroll-snap enabled, the browser silently re-picked a
            // "nearest snap point" after that reorder that was a full card
            // width away from where the track actually was — scrollLeft
            // jumped from ~4 to ~260 with no JS ever touching it (traced
            // directly: no scrollTo/scrollBy/scrollLeft= call fired at
            // all, the browser's own snap machinery did it internally).
            // Turning scroll-snap off entirely removed the jump outright.
            // The trade-off is a free (not snap-aligned) resting position
            // after a manual trackpad/touch scroll — already fine to live
            // with, since the mask fade already handles a card sitting
            // partway off-edge gracefully either way.
            //
            // px-1 (not just py-1): overflow-x-auto clips anything right
            // at its own edge, including the first/last card's own ring
            // (Card's ring-1 ring-foreground/10) — without this the
            // leading card visibly lost a sliver of its own border/corner
            // at rest (scrollLeft 0), looking cut off compared to every
            // other card. A few px of padding here just gives that ring
            // room to render in full; it doesn't materially change where
            // the cards sit.
            //
            // maskImage (inline style, computed above from needsLoop — see
            // that state's own comment): fades both edges once the track is
            // actually looping, signalling "there's always more, keep
            // scrolling" in either direction, rather than a hard, jagged
            // edge wherever a card happens to sit partway off-screen.
            //
            // scrollbar-width/-webkit-scrollbar: hides the native OS
            // scrollbar this track would otherwise grow on interaction —
            // the two <SliderArrowButton>s beside it are this component's
            // own, deliberately designed scroll affordance; a second,
            // unstyled native one underneath read as visual clutter,
            // reported directly as looking tacky.
            className="flex min-w-0 flex-1 gap-4 overflow-x-auto scroll-smooth px-1 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* Leading clone copy — only rendered once looping is actually
                needed (see needsLoop's own comment); plain, non-sortable
                StatCardStatics, never part of `order`/SortableContext. */}
            {needsLoop && orderedStats.map((stat) => <StatCardStatic key={`pre-${stat.id}`} stat={stat} />)}
            <DndContext
              // A fixed, explicit id — without one, dnd-kit generates its
              // screen-reader description element's id from a module-level
              // counter that increments independently on the server and the
              // client, so the two inevitably land on different numbers
              // (e.g. server "DndDescribedBy-0" vs client "...-2") and React
              // flags a hydration mismatch on every load. Passing a stable
              // id here is dnd-kit's own documented fix for exactly this SSR
              // case.
              id="analytics-stat-slider"
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
            >
              <SortableContext items={order} strategy={horizontalListSortingStrategy}>
                {/* The real, draggable set — wrapped in its own flex row
                    (not just a fragment) so middleRef can measure exactly
                    one lap's width, independent of the clone copies sitting
                    beside it as flex siblings within the outer track. */}
                <div ref={middleRef} className="flex shrink-0 gap-4">
                  {orderedStats.map((stat) => (
                    <StatCard key={stat.id} stat={stat} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {/* Trailing clone copy — same reasoning as the leading one above. */}
            {needsLoop && orderedStats.map((stat) => <StatCardStatic key={`post-${stat.id}`} stat={stat} />)}
          </div>
      <SliderArrowButton
        direction="right"
        onClick={() => scrollRef.current?.scrollBy({ left: SCROLL_STEP, behavior: "smooth" })}
      />
    </div>
  );
}
