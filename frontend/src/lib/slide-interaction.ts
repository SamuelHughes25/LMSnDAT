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
  // wider type). missing_word and sequencing report a genuine fraction —
  // e.g. 2 of 3 blanks correct, or 4 of 5 items in the right final
  // position. match_pairs always reports 1 once reported at all (see
  // match-pairs-slide-face.tsx: mismatches bounce back for another try
  // rather than being scored as wrong, so "reported" already means
  // "completed" for this type — there is no partial-credit final state to
  // represent). accordion/flashcards/hotspot_image have no notion of a
  // "correct answer" at all — they're self-paced reveal/study content, not
  // assessments — so all three always report `score: 1, isCorrect: true`
  // the moment every section/card/hotspot has been viewed at least once;
  // "reported" there means "completed," the same way it means "completed"
  // for match_pairs, just without match_pairs' retry-attempt concept.
  score: number;
  answeredAt: string; // ISO timestamp
  detail: unknown; // type-specific raw answer payload, for future review/debugging
};
