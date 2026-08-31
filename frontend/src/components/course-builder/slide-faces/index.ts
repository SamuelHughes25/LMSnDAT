import type { ComponentType } from "react";

import type { Slide, SlideConfig, SlideType } from "@/lib/course-types";
import type { SlideInteractionResult } from "@/lib/slide-interaction";
import { ContentSlideFace } from "./content-slide-face";
import { MissingWordSlideFace } from "./missing-word-slide-face";
import { MultipleChoiceSlideFace } from "./multiple-choice-slide-face";

// Shared prop contract for every slide-type "face" component — the same
// JSX renders the slide at three scales/interactivity levels (thumbnail,
// canvas, the learner-facing preview), so a thumbnail is guaranteed to
// look exactly like the canvas. `onTitleChange`/`onConfigChange` are
// optional because non-interactive renders (thumbnails) never call them.
//
// `mode` distinguishes three genuinely different render contexts:
//  - "edit"    — the builder canvas (slide-canvas.tsx). Fully editable.
//  - "static"  — thumbnails (slide-thumbnail.tsx). Read-only, must never
//                mount anything interactive/expensive.
//  - "present" — the learner-facing preview (course-preview-viewer.tsx).
//                Not editable, but genuinely interactive — distinct from
//                "static" so a quiz-type slide can be clickable in preview
//                while thumbnails stay inert.
//
// `onInteraction` is only meaningful (and only ever called) in "present"
// mode — an interactive type's present-mode component calls it once with a
// SlideInteractionResult when the learner submits/completes their attempt.
// Optional because "edit"/"static" renders never call it, and because
// non-interactive types (e.g. "content") have nothing to report.
export type SlideFaceProps = {
  slide: Slide;
  mode: "edit" | "static" | "present";
  onTitleChange?: (title: string) => void;
  onConfigChange?: (config: Partial<SlideConfig>) => void;
  onInteraction?: (result: SlideInteractionResult) => void;
};

// "content", "multiple_choice", and "missing_word" are buildable so far
// (Stage 3) — match_the_pair lands in the next stage and just adds one entry
// here.
export const SLIDE_TYPE_FACES: Record<SlideType, ComponentType<SlideFaceProps>> = {
  content: ContentSlideFace,
  multiple_choice: MultipleChoiceSlideFace,
  missing_word: MissingWordSlideFace,
};
