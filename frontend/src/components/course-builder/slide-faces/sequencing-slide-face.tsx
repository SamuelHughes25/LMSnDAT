"use client";

import { useState } from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SequencingItem, Slide } from "@/lib/course-types";
import type { SlideInteractionResult } from "@/lib/slide-interaction";
import { useIsClient } from "@/lib/use-is-client";
import { cn, stripHtml } from "@/lib/utils";
import { StaticField } from "./content-slide-face";
import type { SlideFaceProps } from "./index";
import { WIDGET_INPUT_CHROME, WidgetEditableText } from "./widget-text-field";

// UI-guidance min (mirrors match_pairs' MIN_PAIRS — not backend-enforced,
// same progressive-authoring reasoning) and a backend-enforced max.
const MIN_ITEMS = 2;
const MAX_ITEMS = 10;

function makeItemId(n: number) {
  return `seq_${n}_${Date.now().toString(36)}`;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// A plain Fisher-Yates shuffle CAN legitimately reproduce the original
// order by chance — more likely the fewer items there are (a 2-item list
// has a 1-in-2 chance every single time). For this type specifically, the
// authored order IS the answer key, so a shuffle that happens to already
// match it would hand the learner a solved puzzle before they've touched
// anything — the opposite of the point. This re-rolls (bounded, so it can
// never hang) until the result genuinely differs from the input, making
// "the puzzle starts scrambled" a guarantee rather than just probable.
function shuffleDiffering<T>(items: T[]): T[] {
  if (items.length < 2) return [...items];
  let result = shuffle(items);
  let attempts = 0;
  while (result.every((v, i) => v === items[i]) && attempts < 20) {
    result = shuffle(items);
    attempts += 1;
  }
  return result;
}

export function SequencingSlideFace({
  slide,
  mode,
  onConfigChange,
  onInteraction,
  isAssessment,
  priorResult,
}: SlideFaceProps) {
  const instructions = slide.config.instructions ?? "";
  const items = slide.config.sequence_items ?? [];

  if (mode === "edit") {
    return (
      <SequencingEditor slide={slide} instructions={instructions} items={items} onConfigChange={onConfigChange} />
    );
  }

  if (mode === "present") {
    return (
      <SequencingPresent
        slide={slide}
        instructions={instructions}
        items={items}
        onInteraction={onInteraction}
        isAssessment={!!isAssessment}
        priorResult={priorResult}
      />
    );
  }

  return <SequencingStatic instructions={instructions} items={items} />;
}

// On-canvas direct-manipulation editor. Unlike accordion/flashcards' plain
// up/down swap buttons, this list uses a REAL dnd-kit sortable drag — here,
// dragging a row to a new position *is* setting the correct answer order
// (config.sequence_items' own array order), not just a cosmetic authoring
// convenience, so the full drag machinery earns its keep. Mirrors
// slide-rail.tsx's sortable-list pattern exactly (DndContext + PointerSensor
// with a 4px activation threshold + closestCenter; SortableContext +
// useSortable + verticalListSortingStrategy; a drag HANDLE, not the whole
// row, with onClick stopPropagation so grabbing it never also fires a text
// field's own click).
function SequencingEditor({
  slide,
  instructions,
  items,
  onConfigChange,
}: {
  slide: Slide;
  instructions: string;
  items: SequencingItem[];
  onConfigChange: SlideFaceProps["onConfigChange"];
}) {
  const [localItems, setLocalItems] = useState(items);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleTextCommit(index: number, html: string) {
    const next = localItems.map((it, i) => (i === index ? { ...it, text: html } : it));
    setLocalItems(next);
    onConfigChange?.({ sequence_items: next });
  }

  function commitItems(next: SequencingItem[]) {
    setLocalItems(next);
    onConfigChange?.({ sequence_items: next });
  }

  function addItem() {
    if (localItems.length >= MAX_ITEMS) return;
    const n = localItems.length + 1;
    commitItems([...localItems, { id: makeItemId(n), text: "" }]);
  }

  function removeItem(index: number) {
    if (localItems.length <= MIN_ITEMS) return;
    commitItems(localItems.filter((_, i) => i !== index));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localItems.findIndex((it) => it.id === active.id);
    const newIndex = localItems.findIndex((it) => it.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    commitItems(arrayMove(localItems, oldIndex, newIndex));
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 px-16 py-12 text-foreground">
      <WidgetEditableText
        fieldId={`${slide.id}:instructions`}
        value={instructions}
        placeholder="Instructions (optional), e.g. Put these steps in the correct order"
        className="text-2xl font-bold"
        onCommit={(html) => onConfigChange?.({ instructions: html })}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={localItems.map((it) => it.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {localItems.map((item, index) => (
                <SequencingEditorRow
                  key={item.id}
                  fieldId={`${slide.id}:item:${item.id}:text`}
                  item={item}
                  index={index}
                  canRemove={localItems.length > MIN_ITEMS}
                  onTextCommit={(html) => handleTextCommit(index, html)}
                  onRemove={() => removeItem(index)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {localItems.length < MAX_ITEMS && (
        <Button variant="outline" size="sm" onClick={addItem} className="self-start">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add item
        </Button>
      )}
    </div>
  );
}

function SequencingEditorRow({
  fieldId,
  item,
  index,
  canRemove,
  onTextCommit,
  onRemove,
}: {
  fieldId: string;
  item: SequencingItem;
  index: number;
  canRemove: boolean;
  onTextCommit: (html: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-lg border border-border bg-background p-2">
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="cursor-grab touch-none text-muted-foreground"
        aria-label="Drag to reorder item"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="w-6 shrink-0 text-center text-sm text-muted-foreground">{index + 1}</div>
      <div className={cn(WIDGET_INPUT_CHROME, "flex-1")}>
        <WidgetEditableText fieldId={fieldId} value={item.text} placeholder="Step text" onCommit={onTextCommit} />
      </div>
      <Button variant="ghost" size="icon" disabled={!canRemove} onClick={onRemove} aria-label="Remove item">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Genuinely interactive, and genuinely SCORED, learner-facing render —
// unlike accordion/flashcards/hotspot_image, this type has a real correct
// answer (the authored item order). A SEPARATE <DndContext> from the
// builder's own (slide-rail.tsx) and from the editor above — this
// component only ever mounts inside course-preview-viewer.tsx, which has
// no ambient DndContext, so there's no nesting collision (same precedent
// missing-word-slide-face.tsx already established for its own present-mode
// DndContext).
function SequencingPresent({
  slide,
  instructions,
  items,
  onInteraction,
  isAssessment,
  priorResult,
}: {
  slide: Slide;
  instructions: string;
  items: SequencingItem[];
  onInteraction: SlideFaceProps["onInteraction"];
  isAssessment: boolean;
  priorResult?: SlideInteractionResult;
}) {
  // NOT shuffled in the useState lazy initializer directly — confirmed via
  // a real browser that doing so throws a hydration mismatch ("Hydration
  // failed because the server rendered text didn't match the client"):
  // Math.random() inside that initializer runs once during this
  // "use client" component's server render (Next.js still SSRs the initial
  // HTML for client components) and once again during the client's own
  // first render, producing two genuinely different orderings that
  // React's hydration reconciliation can't square. Instead, the initial
  // state is the plain AUTHORED order (deterministic, identical on server
  // and client), and the real shuffle is applied once isClient flips true
  // — see useIsClient's own comment for why that's the point at which a
  // client-only render is guaranteed to no longer be compared against the
  // server's output. hasShuffled guards this from re-firing on every
  // render (same "adjust state during render, guarded so it only fires
  // once" shape as flashcards-slide-face.tsx's flip-reset).
  const isClient = useIsClient();
  const [orderedIds, setOrderedIds] = useState<string[]>(() => items.map((it) => it.id));
  const [hasShuffled, setHasShuffled] = useState(false);
  if (isClient && !hasShuffled) {
    setHasShuffled(true);
    setOrderedIds(shuffleDiffering(items.map((it) => it.id)));
  }
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  // Syncs orderedIds/submitted/score from the server's own record of this
  // slide's answer (priorResult) whenever it CHANGES — ONLY in assessment
  // mode (see priorResult's own doc comment in slide-faces/index.ts). Not a
  // one-time lazy useState initializer — see multiple-choice-slide-
  // face.tsx's identical fix for the full reasoning: a lazy initializer
  // only captures whatever priorResult happens to be at this component's
  // very first render, which is wrong both on a fresh page load (the
  // attempt-resume fetch is still in flight at first mount) and on Retake
  // (priorResult disappearing needs to clear this back to blank too, even
  // without a remount — which here also means letting the shuffle-on-
  // isClient logic above re-shuffle into a fresh order for the new attempt,
  // by resetting hasShuffled rather than leaving the old submitted order in
  // place). Not a useEffect either — see that same file's comment on why
  // this project's lint config specifically flags setState-inside-an-effect,
  // and why the "adjust state during render" shape below is the sanctioned
  // alternative (the same shape isClient/hasShuffled itself already uses,
  // one paragraph up, for the shuffle-once-on-mount logic).
  const [syncedPriorResult, setSyncedPriorResult] = useState(priorResult);
  if (isAssessment && priorResult !== syncedPriorResult) {
    setSyncedPriorResult(priorResult);
    const finalOrder = (priorResult?.detail as { finalOrder?: string[] } | undefined)?.finalOrder ?? null;
    if (finalOrder) {
      setOrderedIds(finalOrder);
      setHasShuffled(true);
      setSubmitted(true);
      setScore(priorResult?.score ?? 0);
    } else {
      setHasShuffled(false);
      setSubmitted(false);
      setScore(0);
    }
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const itemsById = Object.fromEntries(items.map((it) => [it.id, it]));
  const originalIndexById = Object.fromEntries(items.map((it, i) => [it.id, i]));

  function handleDragEnd(event: DragEndEvent) {
    if (submitted) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrderedIds((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function handleSubmit() {
    const correctCount = orderedIds.filter((id, index) => originalIndexById[id] === index).length;
    const finalScore = items.length === 0 ? 0 : correctCount / items.length;
    setScore(finalScore);
    setSubmitted(true);
    onInteraction?.({
      slideId: slide.id,
      slideType: slide.slide_type,
      isCorrect: finalScore === 1,
      score: finalScore,
      answeredAt: new Date().toISOString(),
      detail: { finalOrder: orderedIds },
    });
  }

  function handleTryAgain() {
    setOrderedIds(shuffleDiffering(items.map((it) => it.id)));
    setSubmitted(false);
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full w-full flex-col justify-center gap-6 px-16 py-12 text-foreground">
        {stripHtml(instructions).trim().length > 0 && (
        <div className="text-xl font-semibold">
          <StaticField value={instructions} placeholder="" />
        </div>
      )}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col justify-center gap-6 px-16 py-12 text-foreground">
      {stripHtml(instructions).trim().length > 0 && (
        <div className="text-xl font-semibold">
          <StaticField value={instructions} placeholder="" />
        </div>
      )}

      {/* flex flex-col justify-center HERE, not just on the outer wrapper
          above: this wrapper stretches to fill the full flex-1 height
          (needed so overflow-y-auto has a bounded height to ever actually
          scroll within, for a long list), which claims all the leftover
          space before the outer wrapper's own justify-center ever sees any
          left to distribute — same "doesn't center with few items"
          mechanism as match-pairs' grid columns. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {orderedIds.map((id, index) => (
                <SequencingPresentRow
                  key={id}
                  id={id}
                  text={itemsById[id]?.text ?? ""}
                  submitted={submitted}
                  isCorrectPosition={originalIndexById[id] === index}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {!submitted ? (
        <Button type="button" onClick={handleSubmit} className="self-start">
          Submit
        </Button>
      ) : (
        <div className="flex items-center gap-4">
          <div className="text-sm font-medium text-muted-foreground">
            {Math.round(score * items.length)} of {items.length} in the correct position
          </div>
          {/* Hidden in assessment mode — see missing-word-slide-face.tsx's
              identical comment: the first Submit is the final, graded
              answer there, so a learner can't just reshuffle and resubmit
              until they land on the right order. */}
          {!isAssessment && (
            <Button type="button" variant="outline" onClick={handleTryAgain}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Deliberately no position-number badge (unlike SequencingEditorRow and
// SequencingStatic below, both of which show one) — a number next to a
// row here would read as "this IS step N," an implied claim of
// correctness the row hasn't earned yet: the learner might be looking at
// a still-scrambled arrangement, and even a purely positional "row 1 of
// N" label is easy to misread as an answer key. Editor and static both
// show items in the AUTHORED (already-correct) order, where a number
// genuinely means something.
function SequencingPresentRow({
  id,
  text,
  submitted,
  isCorrectPosition,
}: {
  id: string;
  text: string;
  submitted: boolean;
  isCorrectPosition: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: submitted });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-lg border-2 bg-background p-3",
        !submitted && "border-border",
        submitted && isCorrectPosition && "border-green-600 bg-green-50",
        submitted && !isCorrectPosition && "border-red-600 bg-red-50",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={submitted}
        onClick={(e) => e.stopPropagation()}
        className={cn("touch-none text-muted-foreground", !submitted && "cursor-grab active:cursor-grabbing")}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 text-base">
        <StaticField value={text} placeholder="—" />
      </div>
    </div>
  );
}

// Thumbnail render — items in their AUTHORED (correct) order, plain
// numbered list, no drag handles, non-interactive. "True miniature, not an
// editorial view."
function SequencingStatic({ instructions, items }: { instructions: string; items: SequencingItem[] }) {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-4 px-16 py-12 text-foreground">
      <StaticField value={instructions} placeholder="Click to add instructions" className="text-xl font-semibold" />
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border p-3">
            <div className="w-6 shrink-0 text-center text-sm text-muted-foreground">{index + 1}</div>
            <div className="flex-1 text-base">
              <StaticField value={item.text} placeholder="—" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
