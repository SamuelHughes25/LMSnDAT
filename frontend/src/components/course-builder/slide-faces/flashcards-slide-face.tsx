"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FlashcardItem, Slide } from "@/lib/course-types";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { cn } from "@/lib/utils";
import type { SlideFaceProps } from "./index";

const CHANGE_DEBOUNCE_MS = 500;

// UI-guidance min (a deck of zero cards is meaningless) and a hard-capped
// max (mirrors match_pairs' MIN_PAIRS/MAX_PAIRS split) — only the max is
// enforced server-side (SlideSerializer.validate()'s flashcards branch).
// 20 is generous compared to match_pairs' cap-8: a flashcard holds far less
// info per item than a keyword/definition row, so a real deck (e.g. a
// vocabulary list) reasonably wants more entries.
const MIN_CARDS = 1;
const MAX_CARDS = 20;

function makeCardId(n: number) {
  return `card_${n}_${Date.now().toString(36)}`;
}

export function FlashcardsSlideFace({ slide, mode, onConfigChange, onInteraction }: SlideFaceProps) {
  const cards = slide.config.cards ?? [];

  if (mode === "edit") {
    return <FlashcardsEditor cards={cards} onConfigChange={onConfigChange} />;
  }

  if (mode === "present") {
    return <FlashcardsPresent slide={slide} cards={cards} onInteraction={onInteraction} />;
  }

  return <FlashcardsStatic cards={cards} />;
}

// On-canvas direct-manipulation editor — same list-editing pattern as
// accordion-slide-face.tsx's sections list. Local state mirrors the
// incoming config (remounted via key={slide.id} in slide-canvas.tsx).
function FlashcardsEditor({
  cards,
  onConfigChange,
}: {
  cards: FlashcardItem[];
  onConfigChange: SlideFaceProps["onConfigChange"];
}) {
  const [localCards, setLocalCards] = useState(cards);

  const debouncedCommitCards = useDebouncedCallback(
    (next: FlashcardItem[]) => onConfigChange?.({ cards: next }),
    CHANGE_DEBOUNCE_MS,
  );

  function handleFieldChange(index: number, field: "front" | "back", value: string) {
    const next = localCards.map((c, i) => (i === index ? { ...c, [field]: value } : c));
    setLocalCards(next);
    debouncedCommitCards(next);
  }

  function commitCards(next: FlashcardItem[]) {
    setLocalCards(next);
    onConfigChange?.({ cards: next });
  }

  function addCard() {
    if (localCards.length >= MAX_CARDS) return;
    const n = localCards.length + 1;
    commitCards([...localCards, { id: makeCardId(n), front: "", back: "" }]);
  }

  function removeCard(index: number) {
    if (localCards.length <= MIN_CARDS) return;
    commitCards(localCards.filter((_, i) => i !== index));
  }

  // Up/down swap-and-commit, same reasoning as accordion's moveSection —
  // card order affects only which one comes up first in the deck, never
  // scored, so no full drag machinery is warranted here.
  function moveCard(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= localCards.length) return;
    const next = [...localCards];
    [next[index], next[target]] = [next[target], next[index]];
    commitCards(next);
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 px-16 py-12 text-foreground">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {localCards.map((card, index) => (
          <div key={card.id} className="flex items-center gap-2">
            <Input
              value={card.front}
              onChange={(e) => handleFieldChange(index, "front", e.target.value)}
              placeholder="Front"
              className="flex-1"
            />
            <Input
              value={card.back}
              onChange={(e) => handleFieldChange(index, "back", e.target.value)}
              placeholder="Back"
              className="flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              disabled={index === 0}
              onClick={() => moveCard(index, -1)}
              aria-label="Move card up"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={index === localCards.length - 1}
              onClick={() => moveCard(index, 1)}
              aria-label="Move card down"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={localCards.length <= MIN_CARDS}
              onClick={() => removeCard(index)}
              aria-label="Remove card"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {localCards.length < MAX_CARDS && (
        <Button variant="outline" size="sm" onClick={addCard} className="self-start">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add card
        </Button>
      )}
    </div>
  );
}

// Genuinely interactive learner-facing render. No "correct answer" — a
// self-paced study aid, tracked as completion (every card viewed at least
// once), not correctness. See slide-interaction.ts's doc comment.
//
// No real swipe/flick gesture: this codebase's only drag precedents are
// dnd-kit sortable/draggable and the raw-pointer resize/move patterns in
// image-shared.tsx, neither of which is "swipe to dismiss" — building a
// bespoke drag-direction/velocity state machine for one ambiguous phrase in
// the request would be a distinct, higher-risk feature. Click-to-flip plus
// prev/next buttons with a CSS transition covers the same "nicely styled,
// easy to use" goal with patterns already proven elsewhere in this app.
function FlashcardsPresent({
  slide,
  cards,
  onInteraction,
}: {
  slide: Slide;
  cards: FlashcardItem[];
  onInteraction: SlideFaceProps["onInteraction"];
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // Seeded with the first card (already "viewed" on mount) and extended on
  // every index change — used only to detect "has every card been seen
  // once," never re-derived from currentIndex alone since jumping back to
  // an already-seen card shouldn't un-complete the slide.
  const [visitedIndices, setVisitedIndices] = useState<Set<number>>(() => new Set(cards.length > 0 ? [0] : []));
  const [reported, setReported] = useState(false);

  // Always show the front first when arriving at a (possibly
  // already-visited) card — flip state is per-viewing, not persisted per
  // card. This project's stricter lint rule disallows calling setState
  // synchronously inside a useEffect body (even React's own documented
  // "reset state when a prop changes" pattern), so this uses the
  // recommended alternative instead: adjust state directly during render
  // by comparing against a tracked "previous" value — a real re-render,
  // not an effect round-trip.
  const [prevIndexForFlip, setPrevIndexForFlip] = useState(currentIndex);
  if (currentIndex !== prevIndexForFlip) {
    setPrevIndexForFlip(currentIndex);
    setFlipped(false);
  }

  // Reads visitedIndices directly from the closure and calls
  // setVisitedIndices with a plain computed value, rather than a functional
  // updater — same shape as match-pairs-slide-face.tsx's
  // handleDefinitionClick and accordion-slide-face.tsx's toggleSection. A
  // setState updater function isn't guaranteed to run only once,
  // synchronously, inside the handler that scheduled it — nesting the
  // onInteraction call inside one (an earlier version of this function did)
  // let React invoke it during a later render pass instead, throwing
  // "Cannot update a component while rendering a different component."
  // Calling onInteraction directly in this handler, after a plain
  // (non-updater) setState, avoids the updater entirely.
  function goTo(index: number) {
    if (index < 0 || index >= cards.length) return;
    setCurrentIndex(index);

    if (!visitedIndices.has(index)) {
      const next = new Set(visitedIndices).add(index);
      setVisitedIndices(next);
      if (next.size === cards.length && !reported) {
        setReported(true);
        onInteraction?.({
          slideId: slide.id,
          slideType: slide.slide_type,
          isCorrect: true,
          score: 1,
          answeredAt: new Date().toISOString(),
          detail: { cardsViewed: next.size },
        });
      }
    }
  }

  if (cards.length === 0) {
    return <div className="flex h-full w-full flex-col px-16 py-12 text-foreground" />;
  }

  const card = cards[currentIndex];

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-16 py-12 text-foreground">
      <div className="relative h-56 w-96" style={{ perspective: "1200px" }}>
        {/* Decorative stack peeking out behind the current card — purely
            visual, no state of its own. */}
        {currentIndex < cards.length - 1 && (
          <div className="absolute inset-0 translate-x-2 translate-y-2 scale-[0.97] rounded-xl border-2 border-border bg-muted" />
        )}
        {currentIndex < cards.length - 2 && (
          <div className="absolute inset-0 translate-x-4 translate-y-4 scale-[0.94] rounded-xl border-2 border-border bg-muted/70" />
        )}

        <button
          type="button"
          onClick={() => setFlipped((v) => !v)}
          className="absolute inset-0 h-full w-full text-left"
          style={{ transformStyle: "preserve-3d", transition: "transform 0.4s", transform: flipped ? "rotateY(180deg)" : "none" }}
          aria-label="Click to flip the card"
        >
          <div
            className="absolute inset-0 flex items-center justify-center rounded-xl border-2 border-primary/60 bg-white p-6 text-center text-2xl font-semibold shadow-md"
            style={{ backfaceVisibility: "hidden" }}
          >
            {card.front || "—"}
          </div>
          <div
            className="absolute inset-0 flex items-center justify-center rounded-xl border-2 border-primary bg-primary/5 p-6 text-center text-2xl font-semibold shadow-md"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            {card.back || "—"}
          </div>
        </button>
      </div>

      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" disabled={currentIndex === 0} onClick={() => goTo(currentIndex - 1)} aria-label="Previous card">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-sm font-medium text-muted-foreground">
          {currentIndex + 1} of {cards.length}
        </div>
        <Button
          variant="outline"
          size="icon"
          disabled={currentIndex === cards.length - 1}
          onClick={() => goTo(currentIndex + 1)}
          aria-label="Next card"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Thumbnail render — first card's front only, plain bordered box, no flip,
// no stack, no buttons. "True miniature, not an editorial view."
function FlashcardsStatic({ cards }: { cards: FlashcardItem[] }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-16 py-12 text-foreground">
      {cards.length === 0 ? (
        <span className="text-lg text-muted-foreground/50">Click to add flashcards</span>
      ) : (
        <>
          <div
            className={cn(
              "flex h-40 w-72 items-center justify-center rounded-xl border-2 border-border bg-white p-4 text-center text-xl font-semibold shadow-sm",
            )}
          >
            {cards[0].front || "—"}
          </div>
          <div className="text-sm text-muted-foreground">1/{cards.length} cards</div>
        </>
      )}
    </div>
  );
}
