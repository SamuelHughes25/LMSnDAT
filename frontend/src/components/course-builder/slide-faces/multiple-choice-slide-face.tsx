"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MultipleChoiceOption, Slide } from "@/lib/course-types";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { cn } from "@/lib/utils";
import type { SlideFaceProps } from "./index";

// Same debounce budget as content-slide-face.tsx's TipTap fields — governs
// how often a network PATCH fires while typing into the question/option/
// explanation text fields, not how the field itself feels while typing
// (each field also keeps its own local echo state, updated on every
// keystroke, so there is never any input lag). Discrete actions (add/remove
// option, mark-correct toggle) commit immediately below, no debounce — same
// split already established for list edits elsewhere in this codebase.
const CHANGE_DEBOUNCE_MS = 500;

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;

// Mirrors the id-generation shape already used by
// components/builder/select-options-editor.tsx (`option_${n}_${Date.now()...}`)
// for this app's other list-of-options editor, rather than inventing a new
// convention.
function makeOptionId(n: number) {
  return `option_${n}_${Date.now().toString(36)}`;
}

const FIELD_CLASSES =
  "w-full border-none bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground/50 focus:rounded focus:outline-none focus:ring-1 focus:ring-primary/40";

export function MultipleChoiceSlideFace({ slide, mode, onConfigChange, onInteraction }: SlideFaceProps) {
  const question = slide.config.question ?? "";
  const options = slide.config.options ?? [];
  const feedbackIncorrect = slide.config.feedback_incorrect ?? "";

  if (mode === "edit") {
    return (
      <MultipleChoiceEditor
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
      />
    );
  }

  return <MultipleChoiceStatic question={question} options={options} />;
}

// On-canvas direct-manipulation editor — matches this app's philosophy of
// authoring content on the visual slide itself rather than in a side panel
// (properties-panel.tsx only carries the layout/type-agnostic controls).
// Plain inputs throughout: a rich-text editor per option would be overkill
// for short answer text (see content-slide-face.tsx for the TipTap
// reference this deliberately does NOT follow here).
//
// Local state mirrors the incoming config (same shape as
// select-options-editor.tsx's local-state-mirrors-prop pattern) rather than
// reading straight from `slide.config` on every keystroke — this component
// is remounted via `key={slide.id}` whenever the selected slide changes
// (see slide-canvas.tsx), so there is no risk of local state going stale
// against a different slide's data.
function MultipleChoiceEditor({
  question,
  options,
  feedbackIncorrect,
  onConfigChange,
}: {
  question: string;
  options: MultipleChoiceOption[];
  feedbackIncorrect: string;
  onConfigChange: SlideFaceProps["onConfigChange"];
}) {
  const [localQuestion, setLocalQuestion] = useState(question);
  const [localOptions, setLocalOptions] = useState(options);
  const [localFeedback, setLocalFeedback] = useState(feedbackIncorrect);

  const debouncedCommitQuestion = useDebouncedCallback(
    (value: string) => onConfigChange?.({ question: value }),
    CHANGE_DEBOUNCE_MS,
  );
  const debouncedCommitFeedback = useDebouncedCallback(
    (value: string) => onConfigChange?.({ feedback_incorrect: value }),
    CHANGE_DEBOUNCE_MS,
  );
  // One stable debounced function for the whole `options` array — an option
  // text edit debounce-commits the entire array (matching config's shape),
  // rather than each option row owning its own debounced callback.
  const debouncedCommitOptions = useDebouncedCallback(
    (next: MultipleChoiceOption[]) => onConfigChange?.({ options: next }),
    CHANGE_DEBOUNCE_MS,
  );

  function handleQuestionChange(value: string) {
    setLocalQuestion(value);
    debouncedCommitQuestion(value);
  }

  function handleFeedbackChange(value: string) {
    setLocalFeedback(value);
    debouncedCommitFeedback(value);
  }

  function handleOptionTextChange(index: number, text: string) {
    const next = localOptions.map((opt, i) => (i === index ? { ...opt, text } : opt));
    setLocalOptions(next);
    debouncedCommitOptions(next);
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
    <div className="flex h-full w-full flex-col gap-6 bg-white px-16 py-12 text-foreground">
      <input
        value={localQuestion}
        onChange={(e) => handleQuestionChange(e.target.value)}
        placeholder="Click to add question"
        className={cn(FIELD_CLASSES, "text-3xl font-bold")}
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
            <Input
              value={option.text}
              onChange={(e) => handleOptionTextChange(index, e.target.value)}
              placeholder={`Option ${index + 1}`}
              className="flex-1"
            />
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

      <input
        value={localFeedback}
        onChange={(e) => handleFeedbackChange(e.target.value)}
        placeholder="Explanation for wrong answers (optional)"
        className={cn(FIELD_CLASSES, "border-t border-border pt-3 text-sm text-muted-foreground")}
      />
    </div>
  );
}

// Genuinely interactive learner-facing render (course-preview-viewer.tsx
// today, a real learner player later). No correct-answer indicator is shown
// before answering. A single attempt per view: once `selectedId` is set,
// further clicks on other options are ignored (the buttons are also
// `disabled`) — a simple single-attempt model, deliberately not building a
// "try again" reset for a type that doesn't need one per the plan.
function MultipleChoicePresent({
  slide,
  question,
  options,
  feedbackIncorrect,
  onInteraction,
}: {
  slide: Slide;
  question: string;
  options: MultipleChoiceOption[];
  feedbackIncorrect: string;
  onInteraction: SlideFaceProps["onInteraction"];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function handleSelect(option: MultipleChoiceOption) {
    if (selectedId) return;
    setSelectedId(option.id);
    onInteraction?.({
      slideId: slide.id,
      slideType: slide.slide_type,
      isCorrect: option.is_correct,
      score: option.is_correct ? 1 : 0,
      answeredAt: new Date().toISOString(),
      detail: { selectedOptionId: option.id },
    });
  }

  const selectedOption = selectedId ? (options.find((o) => o.id === selectedId) ?? null) : null;
  const showIncorrectFeedback = !!selectedOption && !selectedOption.is_correct && feedbackIncorrect.trim().length > 0;

  return (
    <div className="flex h-full w-full flex-col gap-6 bg-white px-16 py-12 text-foreground">
      <div className="text-3xl font-bold">
        {question || <span className="text-muted-foreground/50">Untitled question</span>}
      </div>

      <div className="flex flex-1 flex-col justify-center gap-3">
        {options.map((option) => {
          const isSelected = selectedId === option.id;
          const revealState = isSelected ? (option.is_correct ? "correct" : "incorrect") : "neutral";

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option)}
              disabled={!!selectedId}
              className={cn(
                "rounded-lg border-2 px-4 py-3 text-left text-lg transition-colors disabled:cursor-default",
                revealState === "correct" && "border-green-600 bg-green-50 text-green-900",
                revealState === "incorrect" && "border-red-600 bg-red-50 text-red-900",
                revealState === "neutral" && "border-border hover:enabled:border-primary/60 hover:enabled:bg-muted",
              )}
            >
              {option.text || "—"}
            </button>
          );
        })}
      </div>

      {showIncorrectFeedback && (
        <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{feedbackIncorrect}</div>
      )}
    </div>
  );
}

// Thumbnail render — plain read-only text, no interaction, no
// correct-answer indicator. Matches content-slide-face.tsx's thumbnail
// philosophy: a true miniature of the content, not an editorial view.
function MultipleChoiceStatic({ question, options }: { question: string; options: MultipleChoiceOption[] }) {
  return (
    <div className="flex h-full w-full flex-col gap-4 bg-white px-16 py-12 text-foreground">
      <div className="text-3xl font-bold">
        {question || <span className="text-muted-foreground/50">Click to add question</span>}
      </div>
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <div key={option.id} className="rounded-lg border-2 border-border px-4 py-3 text-left text-lg">
            {option.text || "—"}
          </div>
        ))}
      </div>
    </div>
  );
}
