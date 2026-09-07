import type { ComponentType } from "react";

import type { Slide, SlideConfig, SlideType } from "@/lib/course-types";
import type { SlideInteractionResult } from "@/lib/slide-interaction";
import { AccordionSlideFace } from "./accordion-slide-face";
import { ContentSlideFace } from "./content-slide-face";
import { FlashcardsSlideFace } from "./flashcards-slide-face";
import { HotspotImageSlideFace } from "./hotspot-image-slide-face";
import { MatchPairsSlideFace } from "./match-pairs-slide-face";
import { MissingWordSlideFace } from "./missing-word-slide-face";
import { MultipleChoiceSlideFace } from "./multiple-choice-slide-face";
import { SequencingSlideFace } from "./sequencing-slide-face";

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
  // Needed only by content-slide-face.tsx's "image-left"/"image-right"
  // layouts, to attach an uploaded CourseAsset to the right draft (see
  // uploadCourseAsset in app/actions/courses.ts). Optional because every
  // other slide type/mode ignores it — "static"/"present" renders never
  // upload anything, so slide-thumbnail.tsx and course-preview-viewer.tsx
  // never need to pass it.
  courseVersionId?: string;
  // Only meaningful in "present" mode, and only read by the three types
  // with a real "submit an answer, it's either right or wrong" concept —
  // multiple-choice-slide-face.tsx, missing-word-slide-face.tsx, and
  // sequencing-slide-face.tsx. Reported directly as a real gap: all three
  // let a learner retry indefinitely (multiple_choice silently resets a
  // wrong pick after a flash; missing_word/sequencing offer an explicit
  // "Try again" after Submit) — fine, even desirable, for free-form
  // interactive teaching content, but it means a course marked as an
  // assessment could never actually be failed, since the learner just
  // keeps guessing until they land on the right answer. When true, each of
  // those three types makes the learner's first submitted answer
  // permanent (wrong or right) instead of allowing another try — see each
  // component's own present-mode comment for the specific mechanism.
  // match_pairs/accordion/flashcards/hotspot_image ignore this entirely:
  // they're completion-tracking content with no "wrong answer" concept at
  // all (see slide-interaction.ts), so "assessment" doesn't change them.
  isAssessment?: boolean;
};

// "content", "multiple_choice", "missing_word", "match_pairs", "accordion",
// "flashcards", "sequencing", and "hotspot_image" are all buildable now.
export const SLIDE_TYPE_FACES: Record<SlideType, ComponentType<SlideFaceProps>> = {
  content: ContentSlideFace,
  multiple_choice: MultipleChoiceSlideFace,
  missing_word: MissingWordSlideFace,
  match_pairs: MatchPairsSlideFace,
  accordion: AccordionSlideFace,
  flashcards: FlashcardsSlideFace,
  sequencing: SequencingSlideFace,
  hotspot_image: HotspotImageSlideFace,
};
