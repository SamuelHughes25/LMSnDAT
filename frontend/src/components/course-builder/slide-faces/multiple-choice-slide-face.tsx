"use client";

import { useEffect, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MultipleChoiceOption, Slide } from "@/lib/course-types";
import type { SlideInteractionResult } from "@/lib/slide-interaction";
import { cn, stripHtml } from "@/lib/utils";
import { StaticField } from "./content-slide-face";
import type { SlideFaceProps } from "./index";
import { WIDGET_INPUT_CHROME, WidgetEditableText } from "./widget-text-field";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;

// Mirrors the id-generation shape already used by
// components/builder/select-options-editor.tsx (`option_${n}_${Date.now()...}`)
// for this app's other list-of-options editor, rather than inventing a new
// convention.
function makeOptionId(n: number) {
  return `option_${n}_${Date.now().toString(36)}`;
}

export function MultipleChoiceSlideFace({
  slide,
  mode,
  onConfigChange,
  onInteraction,
  isAssessment,
  priorResult,
}: SlideFaceProps) {
  const question = slide.config.question ?? "";
  const options = slide.config.options ?? [];
  const feedbackIncorrect = slide.config.feedback_incorrect ?? "";

  if (mode === "edit") {
    return (
      <MultipleChoiceEditor
        slide={slide}
        question={question}
        options={options}
        feedbackIncorrect={feedbackIncorrect}
        onConfigChange={onConfigChange}
      />
    );
  }

  if (mode === "present") {
    return (
      <MultipleChoicePresent
        slide={slide}
        question={question}
        options={options}
        feedbackIncorrect={feedbackIncorrect}
        onInteraction={onInteraction}
        isAssessment={!!isAssessment}
        priorResult={priorResult}
      />
    );
  }

  return <MultipleChoiceStatic question={question} options={options} />;
}

// On-canvas direct-manipulation editor — matches this app's philosophy of
// authoring content on the visual slide itself rather than in a side panel
// (properties-panel.tsx only carries the layout/type-agnostic controls, now
// including TextFormattingControls once one of these fields is focused —
// see that file's WIDGET_TEXT_SLIDE_TYPES). Each text field is a real
// TipTap instance (WidgetEditableText, widget-text-field.tsx) rather than a
// plain input — the same rich-text capability every other text field in
// this app has, requested directly: "edit everything I normally would
// apart from size."
//
// Local state still mirrors the incoming `options` array (same shape as
// select-options-editor.tsx's local-state-mirrors-prop pattern) — this
// component is remounted via `key={slide.id}` whenever the selected slide
// changes (see slide-canvas.tsx), so there's no risk of local state going
// stale against a different slide's data. Only the array's STRUCTURE lives
// here now (which options exist, their order, is_correct, and id) — each
// option's own TEXT content is owned entirely by its own WidgetEditableText
// instance (debounced-commit internally, same as every other TipTap field),
// not mirrored into this component's state at all.
function MultipleChoiceEditor({
  slide,
  question,
  options,
  feedbackIncorrect,
  onConfigChange,
}: {
  slide: Slide;
  question: string;
  options: MultipleChoiceOption[];
  feedbackIncorrect: string;
  onConfigChange: SlideFaceProps["onConfigChange"];
}) {
  const [localOptions, setLocalOptions] = useState(options);

  function handleOptionTextCommit(index: number, html: string) {
    const next = localOptions.map((opt, i) => (i === index ? { ...opt, text: html } : opt));
    setLocalOptions(next);
    onConfigChange?.({ options: next });
  }

  // Discrete actions (mark-correct, add, remove) commit immediately — no
  // debounce, since each is a single deliberate click rather than a stream
  // of keystrokes.
  function commitOptions(next: MultipleChoiceOption[]) {
    setLocalOptions(next);
    onConfigChange?.({ options: next });
  }

  // Radio semantics: selecting one option clears every other option's flag,
  // so at most one option is ever correct.
  function markCorrect(index: number) {
    commitOptions(localOptions.map((opt, i) => ({ ...opt, is_correct: i === index })));
  }

  function addOption() {
    if (localOptions.length >= MAX_OPTIONS) return;
    const n = localOptions.length + 1;
    commitOptions([...localOptions, { id: makeOptionId(n), text: "", is_correct: false }]);
  }

  function removeOption(index: number) {
    if (localOptions.length <= MIN_OPTIONS) return;
    commitOptions(localOptions.filter((_, i) => i !== index));
  }

  return (
    <div className="flex h-full w-full flex-col gap-6 px-16 py-12 text-foreground">
      <WidgetEditableText
        fieldId={`${slide.id}:question`}
        value={question}
        placeholder="Click to add question"
        className="text-3xl font-bold"
        onCommit={(html) => onConfigChange?.({ question: html })}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {localOptions.map((option, index) => (
          <div key={option.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => markCorrect(index)}
              aria-label={option.is_correct ? "Correct option" : "Mark as correct option"}
              aria-pressed={option.is_correct}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                option.is_correct
                  ? "border-green-600 bg-green-600 text-white"
                  : "border-muted-foreground/40 text-transparent hover:border-muted-foreground",
              )}
            >
              <Check className="h-4 w-4" />
            </button>
            <div className={WIDGET_INPUT_CHROME}>
              <WidgetEditableText
                fieldId={`${slide.id}:option:${option.id}`}
                value={option.text}
                placeholder={`Option ${index + 1}`}
                onCommit={(html) => handleOptionTextCommit(index, html)}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              disabled={localOptions.length <= MIN_OPTIONS}
              onClick={() => removeOption(index)}
              aria-label="Remove option"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {localOptions.length < MAX_OPTIONS && (
        <Button variant="outline" size="sm" onClick={addOption} className="self-start">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add option
        </Button>
      )}

      <WidgetEditableText
        fieldId={`${slide.id}:feedback`}
        value={feedbackIncorrect}
        placeholder="Explanation for wrong answers (optional)"
        className="border-t border-border pt-3 text-sm text-muted-foreground"
        onCommit={(html) => onConfigChange?.({ feedback_incorrect: html })}
      />
    </div>
  );
}

// Genuinely interactive learner-facing render (course-preview-viewer.tsx
// today, a real learner player later). No correct-answer indicator is shown
// before answering. Picking the CORRECT option locks in immediately and
// permanently (same as before). Picking a WRONG one is NOT permanent: it
// flashes red for a moment — same "flash then bounce back" shape as
// match-pairs-slide-face.tsx's flashMismatch — then automatically resets
// so the learner can try again, rather than being stuck having permanently
// "failed" the slide on a single wrong click. onInteraction only ever
// fires once, for the eventual CORRECT selection — a wrong attempt isn't
// a final answer here, so it isn't reported as one (same "a bounce-back
// attempt doesn't count as the scored outcome" idea match_pairs already
// uses for mismatches); how many wrong attempts happened along the way is
// still included in the final report's `detail`, for a future analytics
// pass, without this stage building any scoring around it.
const INCORRECT_FLASH_MS = 1400;

function MultipleChoicePresent({
  slide,
  question,
  options,
  feedbackIncorrect,
  onInteraction,
  isAssessment,
  priorResult,
}: {
  slide: Slide;
  question: string;
  options: MultipleChoiceOption[];
  feedbackIncorrect: string;
  onInteraction: SlideFaceProps["onInteraction"];
  isAssessment: boolean;
  priorResult?: SlideInteractionResult;
}) {
  // The permanent, final pick — right OR wrong. Outside assessment mode
  // this is only ever set for a correct pick (a wrong one goes through
  // flashIncorrectId below instead and never lands here); in assessment
  // mode a wrong pick is locked in here too, since the whole point of an
  // assessment is that the first submitted answer is the one that counts
  // — reported directly: multiple choice previously let a learner just
  // keep guessing forever, silently resetting every wrong pick, so a
  // "scored" assessment built from this type could never actually be
  // failed.
  const [lockedId, setLockedId] = useState<string | null>(null);
  // Briefly holds a WRONG option's id so it can flash red before both the
  // flash and the selection itself reset — non-assessment mode only; see
  // handleSelect.
  const [flashIncorrectId, setFlashIncorrectId] = useState<string | null>(null);
  // Purely for the final report's `detail` payload, not for scoring (see
  // the comment above). Real state, not a ref — the sync block just below
  // needs to set it during render (see that block's own comment on why),
  // and React's lint config disallows mutating a ref's `.current` there.
  const [incorrectAttempts, setIncorrectAttempts] = useState(0);

  // Syncs lockedId/incorrectAttemptsRef from the server's own record of this
  // slide's answer (priorResult) whenever it CHANGES — ONLY in assessment
  // mode (see priorResult's own doc comment in slide-faces/index.ts). Not a
  // one-time lazy useState initializer — a lazy initializer only captures
  // whatever priorResult happens to be at THIS component's very first
  // render, which reported as wrong in two real, confirmed cases: (1) a
  // fresh page load/new tab — course-preview-viewer.tsx's attempt-resume
  // fetch is still in flight at the moment this component first mounts, so
  // priorResult is still undefined on that first render and only arrives a
  // tick later once the fetch resolves; a lazy initializer would have
  // already locked in blank forever. (2) Retake — resets the parent's
  // `results` state to {} for a new attempt WITHOUT necessarily remounting
  // a slide that happens to still be at the same index/id as before, so
  // this component's own lockedId has to clear back to blank too when
  // priorResult disappears, not keep showing a stale locked answer from the
  // just-completed attempt.
  //
  // Also not a useEffect — setting state synchronously inside an effect
  // body is exactly the "cascading renders" anti-pattern this project's
  // lint config (react-hooks/set-state-in-effect) flags. Instead this is
  // the React-sanctioned "adjust state when a prop changes" shape (compare
  // against the last-seen value, and update synchronously DURING render if
  // it changed) — the same shape isClient/hasShuffled already uses below
  // for the shuffle-once-on-mount logic, just tracking priorResult instead
  // of a boolean flag. Doing it during render (not after, in an effect)
  // also means there's no visible one-frame flash of "unlocked" in the
  // ordinary case where priorResult is already available at mount.
  const [syncedPriorResult, setSyncedPriorResult] = useState(priorResult);
  if (isAssessment && priorResult !== syncedPriorResult) {
    setSyncedPriorResult(priorResult);
    const detail = priorResult?.detail as { selectedOptionId?: string; incorrectAttempts?: number } | undefined;
    setLockedId(detail?.selectedOptionId ?? null);
    setIncorrectAttempts(detail?.incorrectAttempts ?? 0);
  }

  // Clears the red flash (and the selection with it) ~1.4s after a wrong
  // pick, giving the learner enough time to read the wrong-answer
  // explanation (if one is set) before the options become clickable again.
  // Never runs in assessment mode — a wrong pick there goes straight to
  // lockedId instead of flashIncorrectId, so there's nothing to clear.
  useEffect(() => {
    if (!flashIncorrectId) return;
    const timer = setTimeout(() => {
      setFlashIncorrectId(null);
    }, INCORRECT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashIncorrectId]);

  function handleSelect(option: MultipleChoiceOption) {
    if (lockedId || flashIncorrectId) return;
    if (option.is_correct) {
      setLockedId(option.id);
      onInteraction?.({
        slideId: slide.id,
        slideType: slide.slide_type,
        isCorrect: true,
        score: 1,
        answeredAt: new Date().toISOString(),
        detail: { selectedOptionId: option.id, incorrectAttempts },
      });
      return;
    }
    // Computed locally, not read back from state — setIncorrectAttempts
    // below won't be reflected in `incorrectAttempts` until the next
    // render, but the detail payload sent this same tick needs the
    // up-to-date count.
    const nextIncorrectAttempts = incorrectAttempts + 1;
    setIncorrectAttempts(nextIncorrectAttempts);
    if (isAssessment) {
      // Permanent — this IS the submitted answer, and it's wrong.
      setLockedId(option.id);
      onInteraction?.({
        slideId: slide.id,
        slideType: slide.slide_type,
        isCorrect: false,
        score: 0,
        answeredAt: new Date().toISOString(),
        detail: { selectedOptionId: option.id, incorrectAttempts: nextIncorrectAttempts },
      });
      return;
    }
    // Non-assessment: flash red, then reset — free-form practice, no
    // permanent record of the wrong pick, no report sent at all.
    setFlashIncorrectId(option.id);
  }

  const lockedOption = lockedId ? options.find((o) => o.id === lockedId) : undefined;
  const isLockedWrong = !!lockedOption && !lockedOption.is_correct;
  const showIncorrectFeedback =
    (!!flashIncorrectId || isLockedWrong) && stripHtml(feedbackIncorrect).trim().length > 0;

  return (
    <div className="flex h-full w-full flex-col justify-center gap-6 px-16 py-12 text-foreground">
      <StaticField value={question} placeholder="Untitled question" className="text-3xl font-bold" />

      <div className="flex flex-1 flex-col justify-center gap-3">
        {options.map((option) => {
          const revealState =
            lockedId === option.id
              ? option.is_correct
                ? "correct"
                : "incorrect"
              : flashIncorrectId === option.id
                ? "incorrect"
                : "neutral";

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option)}
              disabled={!!lockedId || !!flashIncorrectId}
              className={cn(
                "rounded-lg border-2 px-4 py-3 text-left text-lg transition-colors disabled:cursor-default",
                revealState === "correct" && "border-green-600 bg-green-50 text-green-900",
                revealState === "incorrect" && "border-red-600 bg-red-50 text-red-900",
                revealState === "neutral" && "border-border hover:enabled:border-primary/60 hover:enabled:bg-muted",
              )}
            >
              <StaticField value={option.text} placeholder="—" />
            </button>
          );
        })}
      </div>

      {showIncorrectFeedback && (
        <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          <StaticField value={feedbackIncorrect} placeholder="" />
        </div>
      )}
    </div>
  );
}

// Thumbnail render — plain read-only text, no interaction, no
// correct-answer indicator. Matches content-slide-face.tsx's thumbnail
// philosophy: a true miniature of the content, not an editorial view.
function MultipleChoiceStatic({ question, options }: { question: string; options: MultipleChoiceOption[] }) {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-4 px-16 py-12 text-foreground">
      <StaticField value={question} placeholder="Click to add question" className="text-3xl font-bold" />
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <div key={option.id} className="rounded-lg border-2 border-border px-4 py-3 text-left text-lg">
            <StaticField value={option.text} placeholder="—" />
          </div>
        ))}
      </div>
    </div>
  );
}
