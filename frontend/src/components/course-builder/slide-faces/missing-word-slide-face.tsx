"use client";

import { useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MissingWordBlank, Slide } from "@/lib/course-types";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { cn } from "@/lib/utils";
import type { SlideFaceProps } from "./index";

// Same debounce budget as multiple-choice-slide-face.tsx's text fields —
// governs how often a network PATCH fires while typing the paragraph, not
// how the textarea itself feels (local echo state updates on every
// keystroke). Discrete actions (mark blank, remove blank) commit
// immediately, no debounce.
const CHANGE_DEBOUNCE_MS = 500;

function makeBlankId(n: number) {
  return `blank_${n}_${Date.now().toString(36)}`;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

// Drops any blank whose stored start/end offsets no longer slice out its
// original text — the edit-order hazard called out in the plan: editing the
// paragraph after blanks are marked can leave stale offsets pointing at the
// wrong text. Runs on every paragraph edit (not just once on save), mirrored
// server-side by SlideSerializer.validate()'s missing_word branch in
// backend/apps/courses/serializers.py.
function revalidateBlanks(paragraph: string, blanks: MissingWordBlank[]): MissingWordBlank[] {
  return blanks.filter((b) => paragraph.slice(b.start, b.end) === b.text);
}

function sortByStart(blanks: MissingWordBlank[]): MissingWordBlank[] {
  return [...blanks].sort((a, b) => a.start - b.start);
}

// Splits `paragraph` into an ordered list of plain-text runs and blanks,
// suitable for rendering either as static markers or as present-mode drop
// targets. Blanks are sorted by `start` first since an author can mark them
// in any order.
function buildSegments(paragraph: string, blanks: MissingWordBlank[]) {
  const sorted = sortByStart(blanks);
  const segments: ({ type: "text"; text: string } | { type: "blank"; blank: MissingWordBlank })[] = [];
  let cursor = 0;
  for (const blank of sorted) {
    if (blank.start > cursor) segments.push({ type: "text", text: paragraph.slice(cursor, blank.start) });
    segments.push({ type: "blank", blank });
    cursor = blank.end;
  }
  if (cursor < paragraph.length) segments.push({ type: "text", text: paragraph.slice(cursor) });
  return segments;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function MissingWordSlideFace({ slide, mode, onConfigChange, onInteraction }: SlideFaceProps) {
  const paragraph = slide.config.paragraph ?? "";
  const blanks = slide.config.blanks ?? [];

  if (mode === "edit") {
    return <MissingWordEditor paragraph={paragraph} blanks={blanks} onConfigChange={onConfigChange} />;
  }

  if (mode === "present") {
    return (
      <MissingWordPresent slide={slide} paragraph={paragraph} blanks={blanks} onInteraction={onInteraction} />
    );
  }

  return <MissingWordStatic paragraph={paragraph} blanks={blanks} />;
}

// On-canvas direct-manipulation editor. A plain `<textarea>` (native
// selectionStart/selectionEnd, no rich text — see multiple-choice-slide-face
// for why plain inputs are this app's default for short/structured text)
// plus a "mark as blank" action driven off the textarea's own selection.
//
// Local state mirrors the incoming config, same local-state-mirrors-prop
// pattern as multiple-choice-slide-face.tsx / select-options-editor.tsx —
// this component is remounted via `key={slide.id}` whenever the selected
// slide changes (see slide-canvas.tsx), so there is no stale-state risk
// against a different slide's data.
function MissingWordEditor({
  paragraph,
  blanks,
  onConfigChange,
}: {
  paragraph: string;
  blanks: MissingWordBlank[];
  onConfigChange: SlideFaceProps["onConfigChange"];
}) {
  const [localParagraph, setLocalParagraph] = useState(paragraph);
  const [localBlanks, setLocalBlanks] = useState(blanks);
  const [hasSelection, setHasSelection] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const debouncedCommitParagraph = useDebouncedCallback(
    (value: string) => onConfigChange?.({ paragraph: value }),
    CHANGE_DEBOUNCE_MS,
  );

  function commitBlanks(next: MissingWordBlank[]) {
    setLocalBlanks(next);
    onConfigChange?.({ blanks: next });
  }

  function handleParagraphChange(value: string) {
    setLocalParagraph(value);
    const stillValid = revalidateBlanks(value, localBlanks);
    if (stillValid.length !== localBlanks.length) {
      // A blank's stored offsets no longer match this new text — drop it
      // and commit both fields together immediately (not debounced), so a
      // corrupted blank is never left saved even transiently.
      setLocalBlanks(stillValid);
      onConfigChange?.({ paragraph: value, blanks: stillValid });
    } else {
      debouncedCommitParagraph(value);
    }
  }

  // Tracks whether the textarea currently has a non-empty selection, to
  // enable/disable the "mark as blank" button. Fires on selection change via
  // mouse or keyboard (unlike onChange, which only fires on text edits).
  function handleSelect() {
    const el = textareaRef.current;
    setHasSelection(!!el && el.selectionStart !== el.selectionEnd);
  }

  function markSelectedAsBlank() {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) return;
    const overlapsExisting = localBlanks.some((b) => rangesOverlap(start, end, b.start, b.end));
    if (overlapsExisting) return; // silently ignore an overlapping selection
    const text = el.value.slice(start, end);
    commitBlanks([...localBlanks, { id: makeBlankId(localBlanks.length + 1), start, end, text }]);
    setHasSelection(false);
  }

  function removeBlank(id: string) {
    commitBlanks(localBlanks.filter((b) => b.id !== id));
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 px-16 py-12 text-foreground">
      <textarea
        ref={textareaRef}
        value={localParagraph}
        onChange={(e) => handleParagraphChange(e.target.value)}
        onSelect={handleSelect}
        placeholder="Click to add paragraph text, then select words to mark as blanks"
        className="min-h-0 flex-1 resize-none rounded border-none bg-transparent p-0 text-xl leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary/40"
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasSelection}
        onClick={markSelectedAsBlank}
        className="self-start"
      >
        Mark selected text as blank
      </Button>

      {localBlanks.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {sortByStart(localBlanks).map((blank) => (
            <span
              key={blank.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-sm"
            >
              {blank.text}
              <button
                type="button"
                onClick={() => removeBlank(blank.id)}
                aria-label={`Remove blank "${blank.text}"`}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// blankId -> the id of the word currently placed in that slot (or null). A
// blank's id and its own correct word's origin id are the same value (each
// word is authored as belonging to exactly one blank), so "is this blank
// correctly filled" is `placement[blank.id] === blank.id`.
type Placement = Record<string, string | null>;

// Genuinely interactive learner-facing render. A SEPARATE <DndContext> from
// the builder's lesson/slide-reordering ones (slide-rail.tsx) — this
// component only ever mounts inside course-preview-viewer.tsx, which has no
// ambient DndContext of its own, so there is no nesting collision.
function MissingWordPresent({
  slide,
  paragraph,
  blanks,
  onInteraction,
}: {
  slide: Slide;
  paragraph: string;
  blanks: MissingWordBlank[];
  onInteraction: SlideFaceProps["onInteraction"];
}) {
  const [placement, setPlacement] = useState<Placement>(() =>
    Object.fromEntries(blanks.map((b) => [b.id, null])),
  );
  // Shuffled once via this lazy initializer (mount time), and explicitly
  // re-shuffled on "try again" below — never recomputed inline in the
  // render body, which would jump the pool around on every unrelated
  // re-render.
  const [scrambledIds, setScrambledIds] = useState<string[]>(() => shuffle(blanks.map((b) => b.id)));
  const [submitted, setSubmitted] = useState(false);
  const [promptMessage, setPromptMessage] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const blanksById = useMemo(() => Object.fromEntries(blanks.map((b) => [b.id, b])), [blanks]);
  const segments = useMemo(() => buildSegments(paragraph, blanks), [paragraph, blanks]);

  const placedWordIds = new Set(Object.values(placement).filter((v): v is string => v != null));
  const poolIds = scrambledIds.filter((id) => !placedWordIds.has(id));

  function handleDragEnd(event: DragEndEvent) {
    if (submitted) return;
    const wordId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;

    setPlacement((prev) => {
      const next = { ...prev };
      // Clear the word from wherever it currently sits first, so a redrop
      // never leaves it duplicated across two slots.
      for (const key of Object.keys(next)) {
        if (next[key] === wordId) next[key] = null;
      }
      // Dropping onto an actual blank slot places it there — whatever word
      // previously occupied that slot is simply no longer referenced by any
      // key, so it falls back into the pool automatically. Dropping onto
      // the pool (or nowhere) leaves it unplaced, which the loop above
      // already handled.
      if (overId && overId in next) {
        next[overId] = wordId;
      }
      return next;
    });
  }

  function handleSubmit() {
    const allFilled = blanks.every((b) => placement[b.id] != null);
    if (!allFilled) {
      setPromptMessage("Fill in every blank first");
      return;
    }
    const correctCount = blanks.filter((b) => placement[b.id] === b.id).length;
    const score = blanks.length === 0 ? 0 : correctCount / blanks.length;
    setPromptMessage(null);
    setSubmitted(true);
    onInteraction?.({
      slideId: slide.id,
      slideType: slide.slide_type,
      isCorrect: score === 1,
      score,
      answeredAt: new Date().toISOString(),
      detail: { placements: placement },
    });
  }

  function handleTryAgain() {
    setPlacement(Object.fromEntries(blanks.map((b) => [b.id, null])));
    setSubmitted(false);
    setPromptMessage(null);
    setScrambledIds(shuffle(blanks.map((b) => b.id)));
  }

  if (blanks.length === 0) {
    return (
      <div className="flex h-full w-full flex-col gap-6 px-16 py-12 text-foreground">
        <div className="text-xl leading-loose">{paragraph}</div>
      </div>
    );
  }

  const correctCount = blanks.filter((b) => placement[b.id] === b.id).length;

  return (
    <div className="flex h-full w-full flex-col gap-6 px-16 py-12 text-foreground">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="text-xl leading-loose">
          {segments.map((seg, i) =>
            seg.type === "text" ? (
              <span key={i}>{seg.text}</span>
            ) : (
              <BlankSlot
                key={seg.blank.id}
                blank={seg.blank}
                placedWordId={placement[seg.blank.id] ?? null}
                wordText={placement[seg.blank.id] ? blanksById[placement[seg.blank.id]!]?.text : null}
                submitted={submitted}
              />
            ),
          )}
        </div>

        <WordPool wordIds={poolIds} blanksById={blanksById} submitted={submitted} />
      </DndContext>

      {promptMessage && <div className="text-sm text-red-600">{promptMessage}</div>}

      {!submitted ? (
        <Button type="button" onClick={handleSubmit} className="self-start">
          Submit
        </Button>
      ) : (
        <div className="flex items-center gap-4">
          <div className="text-sm font-medium text-muted-foreground">
            {correctCount} of {blanks.length} correct
          </div>
          <Button type="button" variant="outline" onClick={handleTryAgain}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

function BlankSlot({
  blank,
  placedWordId,
  wordText,
  submitted,
}: {
  blank: MissingWordBlank;
  placedWordId: string | null;
  wordText: string | null;
  submitted: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: blank.id, disabled: submitted });
  const isCorrect = submitted && placedWordId === blank.id;
  const isIncorrect = submitted && placedWordId !== blank.id;

  return (
    <span
      ref={setNodeRef}
      style={{ minWidth: `${Math.max(blank.text.length, 4)}ch` }}
      className={cn(
        "mx-1 inline-flex min-h-[1.75rem] items-center justify-center rounded border-2 border-dashed px-2 py-0.5 align-middle",
        !submitted && (isOver ? "border-primary bg-primary/10" : "border-muted-foreground/40"),
        isCorrect && "border-green-600 bg-green-50",
        isIncorrect && "border-red-600 bg-red-50",
      )}
    >
      {placedWordId && <WordChip id={placedWordId} text={wordText ?? ""} disabled={submitted} />}
    </span>
  );
}

function WordPool({
  wordIds,
  blanksById,
  submitted,
}: {
  wordIds: string[];
  blanksById: Record<string, MissingWordBlank>;
  submitted: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "pool", disabled: submitted });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[3rem] flex-wrap items-center gap-2 rounded-lg border-2 border-dashed p-3",
        !submitted && isOver ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      {wordIds.length === 0 ? (
        <span className="text-sm text-muted-foreground/50">All words placed</span>
      ) : (
        wordIds.map((id) => <WordChip key={id} id={id} text={blanksById[id]?.text ?? ""} disabled={submitted} />)
      )}
    </div>
  );
}

function WordChip({ id, text, disabled }: { id: string; text: string; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  const style = transform ? { transform: CSS.Transform.toString(transform) } : undefined;

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      disabled={disabled}
      {...listeners}
      {...attributes}
      className={cn(
        "touch-none select-none rounded-full border border-border bg-white px-3 py-1 text-sm shadow-sm",
        !disabled && "cursor-grab active:cursor-grabbing",
        isDragging && "z-10 opacity-50",
      )}
    >
      {text}
    </button>
  );
}

// Thumbnail render — each blank shown as a simple inline blank marker, no
// drag-drop, no interactivity. Matches this project's "true miniature, not
// an editorial view" thumbnail philosophy already established for content
// and multiple_choice.
function MissingWordStatic({ paragraph, blanks }: { paragraph: string; blanks: MissingWordBlank[] }) {
  const segments = buildSegments(paragraph, blanks);

  return (
    <div className="flex h-full w-full flex-col gap-4 px-16 py-12 text-foreground">
      <div className="text-xl leading-loose">
        {paragraph ? (
          segments.map((seg, i) =>
            seg.type === "text" ? (
              <span key={i}>{seg.text}</span>
            ) : (
              <span
                key={i}
                className="mx-1 inline-block w-16 border-b-2 border-muted-foreground/40 align-middle"
              >
                &nbsp;
              </span>
            ),
          )
        ) : (
          <span className="text-muted-foreground/50">Click to add paragraph text</span>
        )}
      </div>
    </div>
  );
}
