"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MatchPair, Slide } from "@/lib/course-types";
import type { SlideInteractionResult } from "@/lib/slide-interaction";
import { useIsClient } from "@/lib/use-is-client";
import { cn, stripHtml } from "@/lib/utils";
import { StaticField } from "./content-slide-face";
import type { SlideFaceProps } from "./index";
import { WIDGET_INPUT_CHROME, WidgetEditableText } from "./widget-text-field";

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

export function MatchPairsSlideFace({
  slide,
  mode,
  onConfigChange,
  onInteraction,
  isAssessment,
  priorResult,
}: SlideFaceProps) {
  const instructions = slide.config.instructions ?? "";
  const pairs = slide.config.pairs ?? [];

  if (mode === "edit") {
    return (
      <MatchPairsEditor slide={slide} instructions={instructions} pairs={pairs} onConfigChange={onConfigChange} />
    );
  }

  if (mode === "present") {
    return (
      <MatchPairsPresent
        slide={slide}
        instructions={instructions}
        pairs={pairs}
        onInteraction={onInteraction}
        isAssessment={!!isAssessment}
        priorResult={priorResult}
      />
    );
  }

  return <MatchPairsStatic instructions={instructions} pairs={pairs} />;
}

// On-canvas direct-manipulation editor — same list-editing pattern as
// multiple-choice-slide-face.tsx's options list, applied to keyword/
// definition pairs instead. Local state mirrors the incoming config (this
// component is remounted via `key={slide.id}` in slide-canvas.tsx whenever
// the selected slide changes, so there's no stale-state risk).
function MatchPairsEditor({
  slide,
  instructions,
  pairs,
  onConfigChange,
}: {
  slide: Slide;
  instructions: string;
  pairs: MatchPair[];
  onConfigChange: SlideFaceProps["onConfigChange"];
}) {
  const [localPairs, setLocalPairs] = useState(pairs);

  function handleFieldCommit(index: number, field: "keyword" | "definition", html: string) {
    const next = localPairs.map((p, i) => (i === index ? { ...p, [field]: html } : p));
    setLocalPairs(next);
    onConfigChange?.({ pairs: next });
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
      <WidgetEditableText
        fieldId={`${slide.id}:instructions`}
        value={instructions}
        placeholder="Instructions (optional), e.g. Match each term to its definition"
        className="text-2xl font-bold"
        onCommit={(html) => onConfigChange?.({ instructions: html })}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {localPairs.map((pair, index) => (
          <div key={pair.id} className="flex items-center gap-2">
            <div className={cn(WIDGET_INPUT_CHROME, "flex-1")}>
              <WidgetEditableText
                fieldId={`${slide.id}:pair:${pair.id}:keyword`}
                value={pair.keyword}
                placeholder="Keyword"
                onCommit={(html) => handleFieldCommit(index, "keyword", html)}
              />
            </div>
            <div className={cn(WIDGET_INPUT_CHROME, "flex-1")}>
              <WidgetEditableText
                fieldId={`${slide.id}:pair:${pair.id}:definition`}
                value={pair.definition}
                placeholder="Definition"
                onCommit={(html) => handleFieldCommit(index, "definition", html)}
              />
            </div>
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
// null. pairings: EVERY keyword id that has been assigned a definition so
// far, mapped to that definition's id (both ids are the pair's own id, so
// `pairings[k] === k` means that keyword landed on its correct definition —
// same "shared id = correct pair" convention missing_word's `placements`
// already uses). Replaces the old `matchedIds: Set<string>` model, which
// could only represent "matched correctly" and had no way to record a
// permanent wrong pairing at all.
//
// Outside an assessment, behavior is UNCHANGED from before this fix: a
// mismatch bounces back (never enters `pairings`) for another try, and
// completion is only ever a perfect run — see the branch in
// handleDefinitionClick below.
//
// In an assessment, per an explicit user bug report, every click is
// permanent — right or wrong — and gets reported immediately (not just at
// full completion). Reporting on every click, not only the final one, does
// three things at once with the one mechanism: (1) makes each pairing
// permanent server-side the instant it's made, (2) makes partial progress
// survive a mid-exercise remount (Previous/Next) via `priorResult`, since
// `pairings` is restored from it below, and (3) means an attempt abandoned
// half-finished still scores fair partial credit instead of nothing. This
// also naturally produces the exact cascading-mismatch mechanic the user
// asked for with no special-casing: once a wrong definition is picked, it's
// permanently consumed, so whichever keyword actually needed it is
// guaranteed to be forced into whatever's left over by the end — a
// mismatch anywhere makes the slide an overall fail, but the learner is
// never blocked from finishing the rest.
function MatchPairsPresent({
  slide,
  instructions,
  pairs,
  onInteraction,
  isAssessment,
  priorResult,
}: {
  slide: Slide;
  instructions: string;
  pairs: MatchPair[];
  onInteraction: SlideFaceProps["onInteraction"];
  isAssessment: boolean;
  priorResult?: SlideInteractionResult;
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
  const [pairings, setPairings] = useState<Record<string, string>>({});
  // Briefly holds the id of a mismatched attempt so both sides can flash
  // red before bouncing back — cleared by a setTimeout. Only ever set in
  // non-assessment mode: in assessment mode a mismatch is permanent the
  // instant it happens, so there's nothing transient to flash.
  const [flashMismatch, setFlashMismatch] = useState<{ keywordId: string; definitionId: string } | null>(null);
  // Guards the non-assessment "report once, at full completion" path only
  // — assessment mode reports on every click instead (see the doc comment
  // above) and has no equivalent guard to make.
  const [reported, setReported] = useState(false);
  // How many mismatched attempts have occurred so far, purely for inclusion
  // in the reported `detail` payload — NOT itself used for non-assessment
  // scoring (that stays completion-only, per the comment above). Real
  // state, not a ref — the sync block just below needs to set it during
  // render (see that block's own comment on why), and React's lint config
  // disallows mutating a ref's `.current` there.
  const [mismatchCount, setMismatchCount] = useState(0);

  // Syncs pairings/mismatchCountRef from the server's own record of this
  // slide's answer (priorResult) whenever it CHANGES — ONLY in assessment
  // mode (see priorResult's own doc comment in slide-faces/index.ts). Not a
  // one-time lazy useState initializer — see multiple-choice-slide-
  // face.tsx's identical fix for the full reasoning: a lazy initializer
  // only captures whatever priorResult happens to be at this component's
  // very first render, which is wrong both on a fresh page load (the
  // attempt-resume fetch is still in flight at first mount) and on Retake
  // (priorResult disappearing needs to clear this back to blank too, even
  // without a remount). Not a useEffect either — see that same file's
  // comment on why this project's lint config specifically flags
  // setState-inside-an-effect, and why the "adjust state during render"
  // shape below is the sanctioned alternative (the same shape isClient/
  // hasShuffled above already uses for the shuffle-once-on-mount logic).
  const [syncedPriorResult, setSyncedPriorResult] = useState(priorResult);
  if (isAssessment && priorResult !== syncedPriorResult) {
    setSyncedPriorResult(priorResult);
    const detail = priorResult?.detail as
      | { pairings?: Record<string, string>; mismatchCount?: number }
      | undefined;
    setPairings(detail?.pairings ?? {});
    setMismatchCount(detail?.mismatchCount ?? 0);
  }

  const pairsById = useMemo(() => Object.fromEntries(pairs.map((p) => [p.id, p])), [pairs]);
  // Reverse lookup for the definition column: which keyword (if any) has
  // already been permanently assigned to a given definition id.
  const definitionToKeyword = useMemo(
    () => Object.fromEntries(Object.entries(pairings).map(([k, v]) => [v, k])),
    [pairings],
  );

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
    if (keywordId in pairings || flashMismatch) return;
    setSelectedKeywordId((current) => (current === keywordId ? null : keywordId));
  }

  function handleDefinitionClick(definitionId: string) {
    if (definitionId in definitionToKeyword || flashMismatch || !selectedKeywordId) return;
    const keywordId = selectedKeywordId;

    // Non-assessment: UNCHANGED bounce-back behavior. No "final wrong
    // state" concept here — a mismatch just bounces back for another try,
    // and "completed" and "scored 1.0" are the same event, the moment
    // every pair has locked in correctly.
    if (!isAssessment) {
      if (keywordId === definitionId) {
        const next = { ...pairings, [keywordId]: definitionId };
        setPairings(next);
        setSelectedKeywordId(null);

        if (Object.keys(next).length === pairs.length && !reported) {
          setReported(true);
          onInteraction?.({
            slideId: slide.id,
            slideType: slide.slide_type,
            isCorrect: true,
            score: 1,
            answeredAt: new Date().toISOString(),
            detail: { pairings: next, mismatchCount },
          });
        }
      } else {
        setMismatchCount((c) => c + 1);
        setFlashMismatch({ keywordId, definitionId });
        setSelectedKeywordId(null);
      }
      return;
    }

    // Assessment mode: every click is permanent, right or wrong, and is
    // reported immediately (see the doc comment above MatchPairsPresent for
    // why reporting on every click — not just the final one — is what makes
    // this both un-bypassable on remount and correctly partial-credit-able).
    // nextMismatchCount is computed locally, not read back from state —
    // setMismatchCount below won't be reflected in `mismatchCount` until the
    // next render, but the detail payload sent this same tick needs the
    // up-to-date count.
    const nextMismatchCount = keywordId !== definitionId ? mismatchCount + 1 : mismatchCount;
    if (keywordId !== definitionId) {
      setMismatchCount(nextMismatchCount);
    }
    const next = { ...pairings, [keywordId]: definitionId };
    setPairings(next);
    setSelectedKeywordId(null);

    const correctCount = Object.entries(next).filter(([k, v]) => k === v).length;
    const score = pairs.length === 0 ? 0 : correctCount / pairs.length;
    const complete = Object.keys(next).length === pairs.length;
    onInteraction?.({
      slideId: slide.id,
      slideType: slide.slide_type,
      isCorrect: complete && score === 1,
      score,
      answeredAt: new Date().toISOString(),
      detail: { pairings: next, mismatchCount: nextMismatchCount },
    });
  }

  if (pairs.length === 0) {
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
                id in pairings
                  ? pairings[id] === id
                    ? "matched-correct"
                    : "matched-incorrect"
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
                id in definitionToKeyword
                  ? definitionToKeyword[id] === id
                    ? "matched-correct"
                    : "matched-incorrect"
                  : flashMismatch?.definitionId === id
                    ? "mismatch"
                    : "neutral"
              }
              onClick={() => handleDefinitionClick(id)}
            />
          ))}
        </div>
      </div>

      <div className="text-sm font-medium text-muted-foreground">
        {Object.keys(pairings).length} of {pairs.length} {isAssessment ? "answered" : "matched"}
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
  // "matched-correct"/"matched-incorrect" are both PERMANENT (disabled) —
  // the assessment-mode addition is "incorrect", a locked wrong pairing
  // that never existed in the old matched/mismatch-only model (mismatch was
  // always transient there). Non-assessment mode never produces
  // "matched-incorrect": its mismatches stay transient "mismatch" flashes.
  state: "neutral" | "selected" | "matched-correct" | "matched-incorrect" | "mismatch";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "matched-correct" || state === "matched-incorrect"}
      className={cn(
        "rounded-lg border-2 px-4 py-3 text-left text-base transition-colors disabled:cursor-default",
        state === "matched-correct" && "border-green-600 bg-green-50 text-green-900",
        (state === "matched-incorrect" || state === "mismatch") && "border-red-600 bg-red-50 text-red-900",
        state === "selected" && "border-primary bg-primary/10",
        state === "neutral" && "border-border hover:enabled:border-primary/60 hover:enabled:bg-muted",
      )}
    >
      <StaticField value={text} placeholder="—" />
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
      <StaticField value={instructions} placeholder="Click to add instructions" className="text-xl font-semibold" />
      <div className="grid flex-1 grid-cols-2 gap-8">
        <div className="flex flex-col gap-2">
          {pairs.map((pair) => (
            <div key={pair.id} className="rounded-lg border-2 border-border px-4 py-3 text-left text-base">
              <StaticField value={pair.keyword} placeholder="—" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {pairs.map((pair) => (
            <div key={pair.id} className="rounded-lg border-2 border-border px-4 py-3 text-left text-base">
              <StaticField value={pair.definition} placeholder="—" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
