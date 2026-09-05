"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MatchPair, Slide } from "@/lib/course-types";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { useIsClient } from "@/lib/use-is-client";
import { cn } from "@/lib/utils";
import type { SlideFaceProps } from "./index";

// Same debounce budget as the other two slide-face editors — governs how
// often a network PATCH fires while typing into the instructions/keyword/
// definition fields, not how the field itself feels (local echo state
// updates on every keystroke). Discrete actions (add/remove pair) commit
// immediately, no debounce — same split established in
// multiple-choice-slide-face.tsx / missing-word-slide-face.tsx.
const CHANGE_DEBOUNCE_MS = 500;

// The spec's "min 2 pairs" is enforced here as UI guidance only (disables
// delete at 2 remaining) — the backend deliberately does NOT hard-reject a
// save with fewer than 2 pairs (see the match_pairs branch of
// SlideSerializer.validate() in backend/apps/courses/serializers.py), since
// every PATCH in this app is a real save with no separate "submit for real"
// step, and hard-blocking a mid-authoring single pair caused real bugs for
// the previous two slide types. The UI still guides toward the eventual
// target of >=2 once the author has started, without ever making the save
// itself fail.
const MIN_PAIRS = 2;
const MAX_PAIRS = 8;

function makePairId(n: number) {
  return `pair_${n}_${Date.now().toString(36)}`;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const FIELD_CLASSES =
  "w-full border-none bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground/50 focus:rounded focus:outline-none focus:ring-1 focus:ring-primary/40";

export function MatchPairsSlideFace({ slide, mode, onConfigChange, onInteraction }: SlideFaceProps) {
  const instructions = slide.config.instructions ?? "";
  const pairs = slide.config.pairs ?? [];

  if (mode === "edit") {
    return <MatchPairsEditor instructions={instructions} pairs={pairs} onConfigChange={onConfigChange} />;
  }

  if (mode === "present") {
    return <MatchPairsPresent slide={slide} instructions={instructions} pairs={pairs} onInteraction={onInteraction} />;
  }

  return <MatchPairsStatic instructions={instructions} pairs={pairs} />;
}

// On-canvas direct-manipulation editor — same list-editing pattern as
// multiple-choice-slide-face.tsx's options list, applied to keyword/
// definition pairs instead. Local state mirrors the incoming config (this
// component is remounted via `key={slide.id}` in slide-canvas.tsx whenever
// the selected slide changes, so there's no stale-state risk).
function MatchPairsEditor({
  instructions,
  pairs,
  onConfigChange,
}: {
  instructions: string;
  pairs: MatchPair[];
  onConfigChange: SlideFaceProps["onConfigChange"];
}) {
  const [localInstructions, setLocalInstructions] = useState(instructions);
  const [localPairs, setLocalPairs] = useState(pairs);

  const debouncedCommitInstructions = useDebouncedCallback(
    (value: string) => onConfigChange?.({ instructions: value }),
    CHANGE_DEBOUNCE_MS,
  );
  // One stable debounced function for the whole `pairs` array — a keyword
  // or definition edit debounce-commits the entire array (matching
  // config's shape), same approach as multiple_choice's options.
  const debouncedCommitPairs = useDebouncedCallback(
    (next: MatchPair[]) => onConfigChange?.({ pairs: next }),
    CHANGE_DEBOUNCE_MS,
  );

  function handleInstructionsChange(value: string) {
    setLocalInstructions(value);
    debouncedCommitInstructions(value);
  }

  function handleFieldChange(index: number, field: "keyword" | "definition", value: string) {
    const next = localPairs.map((p, i) => (i === index ? { ...p, [field]: value } : p));
    setLocalPairs(next);
    debouncedCommitPairs(next);
  }

  // Discrete actions (add, remove) commit immediately — no debounce, since
  // each is a single deliberate click rather than a stream of keystrokes.
  function commitPairs(next: MatchPair[]) {
    setLocalPairs(next);
    onConfigChange?.({ pairs: next });
  }

  function addPair() {
    if (localPairs.length >= MAX_PAIRS) return;
    const n = localPairs.length + 1;
    commitPairs([...localPairs, { id: makePairId(n), keyword: "", definition: "" }]);
  }

  function removePair(index: number) {
    if (localPairs.length <= MIN_PAIRS) return;
    commitPairs(localPairs.filter((_, i) => i !== index));
  }

  return (
    <div className="flex h-full w-full flex-col gap-6 px-16 py-12 text-foreground">
      <input
        value={localInstructions}
        onChange={(e) => handleInstructionsChange(e.target.value)}
        placeholder="Instructions (optional), e.g. Match each term to its definition"
        className={cn(FIELD_CLASSES, "text-2xl font-bold")}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {localPairs.map((pair, index) => (
          <div key={pair.id} className="flex items-center gap-2">
            <Input
              value={pair.keyword}
              onChange={(e) => handleFieldChange(index, "keyword", e.target.value)}
              placeholder="Keyword"
              className="flex-1"
            />
            <Input
              value={pair.definition}
              onChange={(e) => handleFieldChange(index, "definition", e.target.value)}
              placeholder="Definition"
              className="flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              disabled={localPairs.length <= MIN_PAIRS}
              onClick={() => removePair(index)}
              aria-label="Remove pair"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {localPairs.length < MAX_PAIRS && (
        <Button variant="outline" size="sm" onClick={addPair} className="self-start">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add pair
        </Button>
      )}
    </div>
  );
}

// selectedKeywordId: the keyword currently awaiting a definition click, or
// null. matchedIds: the set of pair ids that have already locked in
// correctly and are no longer interactive.
function MatchPairsPresent({
  slide,
  instructions,
  pairs,
  onInteraction,
}: {
  slide: Slide;
  instructions: string;
  pairs: MatchPair[];
  onInteraction: SlideFaceProps["onInteraction"];
}) {
  // Two SEPARATE shuffles (not sharing an order) — this is what makes it a
  // real matching puzzle rather than a matching-to-fixed-order task, per
  // the plan. NOT shuffled directly in the useState lazy initializer:
  // confirmed via a real browser that doing so throws a hydration mismatch
  // ("Hydration failed because the server rendered text didn't match the
  // client") — Math.random() inside that initializer runs once during this
  // "use client" component's server render (Next.js still SSRs the initial
  // HTML for client components) and once again during the client's own
  // first render, producing two different orderings React's hydration
  // reconciliation can't square. Instead, the initial state is the plain
  // authored order (deterministic, identical on server and client), and
  // the real shuffle is applied once isClient flips true — see
  // useIsClient's own comment for why that's the point at which a
  // client-only render is guaranteed to no longer be compared against the
  // server's output. hasShuffled guards this from re-firing every render.
  const isClient = useIsClient();
  const [keywordOrder, setKeywordOrder] = useState<string[]>(() => pairs.map((p) => p.id));
  const [definitionOrder, setDefinitionOrder] = useState<string[]>(() => pairs.map((p) => p.id));
  const [hasShuffled, setHasShuffled] = useState(false);
  if (isClient && !hasShuffled) {
    setHasShuffled(true);
    setKeywordOrder(shuffle(pairs.map((p) => p.id)));
    setDefinitionOrder(shuffle(pairs.map((p) => p.id)));
  }

  const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<Set<string>>(new Set());
  // Briefly holds the id of a mismatched attempt so both sides can flash
  // red before deselecting — cleared by a setTimeout.
  const [flashMismatch, setFlashMismatch] = useState<{ keywordId: string; definitionId: string } | null>(null);
  const [reported, setReported] = useState(false);
  // How many mismatched attempts have occurred so far, purely for inclusion
  // in the reported `detail` payload below — NOT used for scoring (see the
  // scoring-choice comment above `handleDefinitionClick`). A ref, not
  // state: it doesn't drive any render, it only needs to be read once, at
  // the moment of the final successful match.
  const mismatchCountRef = useRef(0);

  const pairsById = useMemo(() => Object.fromEntries(pairs.map((p) => [p.id, p])), [pairs]);

  // Clears a mismatch flash ~650ms after it's set, so the learner gets a
  // brief visible "that was wrong" beat before both sides go interactive
  // again — no lasting penalty marker, just transient feedback, per the
  // plan ("no lasting penalty marker needed, just visual feedback").
  useEffect(() => {
    if (!flashMismatch) return;
    const timer = setTimeout(() => setFlashMismatch(null), 650);
    return () => clearTimeout(timer);
  }, [flashMismatch]);

  function handleKeywordClick(keywordId: string) {
    if (matchedIds.has(keywordId) || flashMismatch) return;
    setSelectedKeywordId((current) => (current === keywordId ? null : keywordId));
  }

  // Scoring choice, deliberately made and documented here (also in
  // slide-interaction.ts): this type has no "final wrong state" the way
  // multiple_choice/missing_word do — a mismatch just bounces back for
  // another try rather than being scored as permanently wrong, and the plan
  // doesn't ask retry attempts to be penalized ("no lasting penalty marker
  // needed"). So "completed" and "scored 1.0" are the same event here:
  // `score` is always 1 the moment every pair has locked in, and
  // `detail.mismatchCount` is still included so a future analytics pass can
  // see retry friction without this stage having to build scoring around it.
  function handleDefinitionClick(definitionId: string) {
    if (matchedIds.has(definitionId) || flashMismatch || !selectedKeywordId) return;

    if (selectedKeywordId === definitionId) {
      const next = new Set(matchedIds);
      next.add(definitionId);
      setMatchedIds(next);
      setSelectedKeywordId(null);

      if (next.size === pairs.length && !reported) {
        setReported(true);
        onInteraction?.({
          slideId: slide.id,
          slideType: slide.slide_type,
          isCorrect: true,
          score: 1,
          answeredAt: new Date().toISOString(),
          detail: { matchedPairIds: Array.from(next), mismatchCount: mismatchCountRef.current },
        });
      }
    } else {
      mismatchCountRef.current += 1;
      setFlashMismatch({ keywordId: selectedKeywordId, definitionId });
      setSelectedKeywordId(null);
    }
  }

  if (pairs.length === 0) {
    return (
      <div className="flex h-full w-full flex-col justify-center gap-6 px-16 py-12 text-foreground">
        {instructions && <div className="text-xl font-semibold">{instructions}</div>}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col justify-center gap-6 px-16 py-12 text-foreground">
      {instructions && <div className="text-xl font-semibold">{instructions}</div>}

      {/* justify-center on each column, not just the outer wrapper above:
          this grid's cells stretch to the full flex-1 height (CSS Grid's
          default align-items: stretch), so with few pairs the tiles were
          still stacking from each column's own top edge, leaving empty
          space below — the same "doesn't center until you add enough items
          to fill the space" report, just one level deeper than the other
          slide types this round, since a flex-1/grid ancestor's leftover
          space is claimed by stretch/grow before the outer justify-center
          ever gets anything left to distribute. */}
      <div className="grid flex-1 grid-cols-2 gap-8">
        <div className="flex flex-col justify-center gap-2">
          {keywordOrder.map((id) => (
            <MatchTile
              key={id}
              text={pairsById[id]?.keyword ?? ""}
              state={
                matchedIds.has(id)
                  ? "matched"
                  : flashMismatch?.keywordId === id
                    ? "mismatch"
                    : selectedKeywordId === id
                      ? "selected"
                      : "neutral"
              }
              onClick={() => handleKeywordClick(id)}
            />
          ))}
        </div>
        <div className="flex flex-col justify-center gap-2">
          {definitionOrder.map((id) => (
            <MatchTile
              key={id}
              text={pairsById[id]?.definition ?? ""}
              state={
                matchedIds.has(id) ? "matched" : flashMismatch?.definitionId === id ? "mismatch" : "neutral"
              }
              onClick={() => handleDefinitionClick(id)}
            />
          ))}
        </div>
      </div>

      <div className="text-sm font-medium text-muted-foreground">
        {matchedIds.size} of {pairs.length} matched
      </div>
    </div>
  );
}

function MatchTile({
  text,
  state,
  onClick,
}: {
  text: string;
  state: "neutral" | "selected" | "matched" | "mismatch";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "matched"}
      className={cn(
        "rounded-lg border-2 px-4 py-3 text-left text-base transition-colors disabled:cursor-default",
        state === "matched" && "border-green-600 bg-green-50 text-green-900",
        state === "mismatch" && "border-red-600 bg-red-50 text-red-900",
        state === "selected" && "border-primary bg-primary/10",
        state === "neutral" && "border-border hover:enabled:border-primary/60 hover:enabled:bg-muted",
      )}
    >
      {text || "—"}
    </button>
  );
}

// Thumbnail render — both columns as plain read-only text, no interaction,
// no shuffling (shuffling only matters for the present-mode puzzle).
// Matches this project's "true miniature, not an editorial view" thumbnail
// philosophy already established for content/multiple_choice/missing_word.
function MatchPairsStatic({ instructions, pairs }: { instructions: string; pairs: MatchPair[] }) {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-4 px-16 py-12 text-foreground">
      <div className="text-xl font-semibold">
        {instructions || <span className="text-muted-foreground/50">Click to add instructions</span>}
      </div>
      <div className="grid flex-1 grid-cols-2 gap-8">
        <div className="flex flex-col gap-2">
          {pairs.map((pair) => (
            <div key={pair.id} className="rounded-lg border-2 border-border px-4 py-3 text-left text-base">
              {pair.keyword || "—"}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {pairs.map((pair) => (
            <div key={pair.id} className="rounded-lg border-2 border-border px-4 py-3 text-left text-base">
              {pair.definition || "—"}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
