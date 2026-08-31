import type { ComponentType } from "react";

import type { Slide, SlideConfig, SlideType } from "@/lib/course-types";
import { ContentSlideFace } from "./content-slide-face";

// Shared prop contract for every slide-type "face" component — the same
// JSX renders the slide at three scales/interactivity levels (thumbnail,
// canvas, later a learner-facing preview), so a thumbnail is guaranteed to
// look exactly like the canvas. `onTitleChange`/`onConfigChange` are
// optional because non-interactive renders (thumbnails) never call them.
//
// `mode` distinguishes three genuinely different render contexts:
//  - "edit"    — the builder canvas (slide-canvas.tsx). Fully editable.
//  - "static"  — thumbnails (slide-thumbnail.tsx). Read-only, must never
//                mount anything interactive/expensive.
//  - "present" — the learner-facing preview (course-preview-viewer.tsx).
//                Not editable, but (for future slide types) genuinely
//                interactive — distinct from "static" so a quiz-type slide
//                can be clickable in preview while thumbnails stay inert.
export type SlideFaceProps = {
  slide: Slide;
  mode: "edit" | "static" | "present";
  onTitleChange?: (title: string) => void;
  onConfigChange?: (config: Partial<SlideConfig>) => void;
};

// Only "content" is buildable this stage (Stage 2b) — multiple_choice,
// categorize, survey_rating, number_slider, and game_rapid_fire land in
// Stage 3/4 and each just add one entry here.
export const SLIDE_TYPE_FACES: Record<SlideType, ComponentType<SlideFaceProps>> = {
  content: ContentSlideFace,
};
