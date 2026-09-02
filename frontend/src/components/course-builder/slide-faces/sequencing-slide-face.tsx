"use client";

import { useState } from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SequencingItem, Slide } from "@/lib/course-types";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { useIsClient } from "@/lib/use-is-client";
import { cn } from "@/lib/utils";
import type { SlideFaceProps } from "./index";

const CHANGE_DEBOUNCE_MS = 500;

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

export function SequencingSlideFace({ slide, mode, onConfigChange, onInteraction }: SlideFaceProps) {
  const instructions = slide.config.instructions ?? "";
  const items = slide.config.sequence_items ?? [];

  if (mode === "edit") {
    return <SequencingEditor instructions={instructions} items={items} onConfigChange={onConfigChange} />;
  }

  if (mode === "present") {
    return (
      <SequencingPresent slide={slide} instructions={instructions} items={items} onInteraction={onInteraction} />
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
  instructions,
  items,
  onConfigChange,
}: {
  instructions: string;
  items: SequencingItem[];
  onConfigChange: SlideFaceProps["onConfigChange"];
}) {
  const [localInstructions, setLocalInstructions] = useState(instructions);
  const [localItems, setLocalItems] = useState(items);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const debouncedCommitInstructions = useDebouncedCallback(
    (value: string) => onConfigChange?.({ instructions: value }),
    CHANGE_DEBOUNCE_MS,
  );
  const debouncedCommitItems = useDebouncedCallback(
    (next: SequencingItem[]) => onConfigChange?.({ sequence_items: next }),
    CHANGE_DEBOUNCE_MS,
  );

  function handleInstructionsChange(value: string) {
    setLocalInstructions(value);
    debouncedCommitInstructions(value);
  }

  function handleTextChange(index: number, value: string) {
    const next = localItems.map((it, i) => (i === index ? { ...it, text: value } : it));
    setLocalItems(next);
    debouncedCommitItems(next);
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
      <input
        value={localInstructions}
        onChange={(e) => handleInstructionsChange(e.target.value)}
        placeholder="Instructions (optional), e.g. Put these steps in the correct order"
        className="w-full border-none bg-transparent p-0 text-2xl font-bold text-foreground outline-none placeholder:text-muted-foreground/50 focus:rounded focus:ring-1 focus:ring-primary/40"
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={localItems.map((it) => it.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {localItems.map((item, index) => (
                <SequencingEditorRow
                  key={item.id}
                  item={item}
                  index={index}
                  canRemove={localItems.length > MIN_ITEMS}
                  onTextChange={(value) => handleTextChange(index, value)}
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
  item,
  index,
  canRemove,
  onTextChange,
  onRemove,
}: {
  item: SequencingItem;
  index: number;
  canRemove: boolean;
  onTextChange: (value: string) => void;
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
      <Input value={item.text} onChange={(e) => onTextChange(e.target.value)} placeholder="Step text" className="flex-1" />
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
}: {
  slide: Slide;
  instructions: string;
  items: SequencingItem[];
  onInteraction: SlideFaceProps["onInteraction"];
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
    setOrderedIds(shuffle(items.map((it) => it.id)));
  }
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
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
    setOrderedIds(shuffle(items.map((it) => it.id)));
    setSubmitted(false);
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full w-full flex-col gap-6 px-16 py-12 text-foreground">
        {instructions && <div className="text-xl font-semibold">{instructions}</div>}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-6 px-16 py-12 text-foreground">
      {instructions && <div className="text-xl font-semibold">{instructions}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {orderedIds.map((id, index) => (
                <SequencingPresentRow
                  key={id}
                  id={id}
                  index={index}
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
          <Button type="button" variant="outline" onClick={handleTryAgain}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

function SequencingPresentRow({
  id,
  index,
  text,
  submitted,
  isCorrectPosition,
}: {
  id: string;
  index: number;
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
      <div className="w-6 shrink-0 text-center text-sm text-muted-foreground">{index + 1}</div>
      <div className="flex-1 text-base">{text || "—"}</div>
    </div>
  );
}

// Thumbnail render — items in their AUTHORED (correct) order, plain
// numbered list, no drag handles, non-interactive. "True miniature, not an
// editorial view."
function SequencingStatic({ instructions, items }: { instructions: string; items: SequencingItem[] }) {
  return (
    <div className="flex h-full w-full flex-col gap-4 px-16 py-12 text-foreground">
      <div className="text-xl font-semibold">
        {instructions || <span className="text-muted-foreground/50">Click to add instructions</span>}
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border p-3">
            <div className="w-6 shrink-0 text-center text-sm text-muted-foreground">{index + 1}</div>
            <div className="flex-1 text-base">{item.text || "—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
