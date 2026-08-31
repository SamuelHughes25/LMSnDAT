import type { SlideType } from "./course-types";

// Standard result every interactive slide type's "present" mode reports
// once a learner submits/completes an attempt. Deliberately the entire
// scope of "tracking" this pass: course-preview-viewer.tsx collects these
// into local-only state (no backend call, no persistence — there's no
// learner/assignment model to attach results to yet). The shape and the
// onInteraction call site are what a later, real persistence phase needs;
// see docs/PROJECT_LOG.md for the scope decision.
export type SlideInteractionResult = {
  slideId: string;
  slideType: SlideType;
  isCorrect: boolean;
  // 0-1, fraction correct — always 0 or 1 for multiple_choice (single
  // answer, no partial credit; those literal values still satisfy this
  // wider type). missing_word reports a genuine fraction — e.g. 2 of 3
  // blanks correct. match_pairs always reports 1 once reported at all (see
  // match-pairs-slide-face.tsx: mismatches bounce back for another try
  // rather than being scored as wrong, so "reported" already means
  // "completed" for this type — there is no partial-credit final state to
  // represent).
  score: number;
  answeredAt: string; // ISO timestamp
  detail: unknown; // type-specific raw answer payload, for future review/debugging
};
