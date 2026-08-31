// Mirrors backend/apps/courses/constants.py and the DRF serializers in
// backend/apps/courses/serializers.py — keep these in sync by hand for now
// (no shared schema codegen yet). Split out from lib/types.ts (the
// templates/questions domain) so the two authoring domains stay
// independently legible.

// "content", "multiple_choice", "missing_word", and "match_pairs" are
// buildable so far (Stage 4). Typed as a string union (not a single string
// literal alias) so later stages can widen it to also include "categorize" |
// "survey_rating" | "number_slider" | "game_rapid_fire" without touching
// call sites — mirrors backend/apps/courses/constants.py's SlideType enum.
export type SlideType = "content" | "multiple_choice" | "missing_word" | "match_pairs";

export type CourseVersionStatus = "draft" | "published" | "archived";

export type TransitionStyle = "none" | "fade" | "slide";

export type AssetKind = "image" | "video" | "other";

// Curated layout presets for the "content" slide_type — the author picks
// one, then fills in that layout's fixed placeholders (title + one shared
// body field). "image-left"/"image-right" are deliberately not modeled yet:
// there's no asset upload wired up until Stage 3, so building those layouts
// now would just be dead UI. See slide-faces/content-slide-face.tsx for the
// arrangement each value renders.
export type ContentSlideLayout = "title-body" | "two-column" | "title-only";

// A single multiple_choice answer option. Single-answer (radio) semantics:
// at most one option in a given `options` array should ever have
// `is_correct: true` — enforced client-side by the mark-correct button in
// multiple-choice-slide-face.tsx clearing every other option's flag, and
// checked server-side (at least one correct, 2-5 options total) by
// SlideSerializer.validate() in backend/apps/courses/serializers.py.
export type MultipleChoiceOption = {
  id: string;
  text: string;
  is_correct: boolean;
};

// A single missing_word blank. `start`/`end` are character offsets into the
// slide's `config.paragraph` string (not the word text itself — offsets are
// precise and unambiguous even when a word repeats elsewhere in the
// paragraph). `text` is a denormalized copy of `paragraph.slice(start, end)`
// captured at mark-time, kept in sync client-side whenever the paragraph is
// edited (see missing-word-slide-face.tsx's revalidateBlanks) and enforced
// server-side by SlideSerializer.validate() in
// backend/apps/courses/serializers.py.
export type MissingWordBlank = {
  id: string;
  start: number;
  end: number;
  text: string;
};

// A single match_pairs keyword/definition pair. `id` is the join key used
// to score a present-mode match (a click-to-pair attempt is "correct" iff
// the selected keyword's pair id equals the selected definition's pair id)
// — same denormalized-id-as-join-key shape as MissingWordBlank above.
export type MatchPair = {
  id: string;
  keyword: string;
  definition: string;
};

// Type-specific slide content. The "content" and "multiple_choice"
// slide_types' shapes are modeled concretely so far; the index signature
// keeps this open for the other slide_types' config shapes (blanks, pairs,
// etc.) added in later stages, same approach as QuestionConfig in
// lib/types.ts.
export type SlideConfig = {
  // content
  layout?: ContentSlideLayout;
  // Sanitized HTML string authored by the TipTap rich-text editor in
  // slide-faces/content-slide-face.tsx (bold/italic/underline/lists/font-size
  // marks) — not plain text. `Slide.config` is an untyped JSONField on the
  // backend, so this widened from plain text to HTML with no schema change.
  // Any non-interactive render of this value MUST sanitize with DOMPurify
  // before use (e.g. dangerouslySetInnerHTML) — it's authored by trusted
  // admins today, but course-preview-viewer.tsx already renders it to
  // arbitrary learners once a course is published.
  body?: string;
  // Second column's text, used only when layout is "two-column" — a genuinely
  // separate field/text box (not one field CSS-split into columns): CSS
  // `columns` only wraps text into a second column once it overflows the
  // container's height, so a short body would render identically to
  // "title-body" and the layout picker would look like it did nothing.
  // Same sanitized-HTML-string shape and rules as `body` above.
  body2?: string;
  image_url?: string | null;
  image_position?: "top" | "bottom" | "left" | "right";
  // multiple_choice
  question?: string;
  options?: MultipleChoiceOption[];
  // Shown only when the learner picks a wrong option in "present" mode —
  // optional (blank is fine), no "feedback_correct" counterpart this pass
  // (not asked for, keeps the config smaller).
  feedback_incorrect?: string;
  // missing_word
  paragraph?: string;
  blanks?: MissingWordBlank[];
  // match_pairs
  // Optional prompt shown above the two columns in "present"/"static" modes
  // (e.g. "Match each term to its definition.") — blank is fine, same
  // optional-with-no-fallback-copy treatment as feedback_incorrect above.
  instructions?: string;
  pairs?: MatchPair[];
  [key: string]: unknown;
};

export type Slide = {
  id: string;
  lesson: string;
  slide_type: SlideType;
  // Sanitized HTML string authored by the same TipTap rich-text editor as
  // `config.body`/`body2` above (bold/italic/underline/font-size marks,
  // single line only — see slide-faces/content-slide-face.tsx's
  // RichTextTitle) — not plain text. The backend's `title` is a plain
  // CharField with no shape validation (the same situation `config`
  // JSONField was already in), so this widened from plain text to HTML with
  // no backend change. Rows written before this change store plain text
  // with no wrapping tags; that's fine to read as-is, since ProseMirror's
  // HTML parser auto-wraps loose top-level text into a paragraph the same
  // way it would `<p>...</p>` — old titles keep displaying correctly and
  // only get rewritten in the `<p>` shape once a user actually edits them.
  // Any non-interactive render of this value MUST sanitize with DOMPurify
  // before use (e.g. dangerouslySetInnerHTML) — same reasoning as
  // `config.body` above: authored by trusted admins today, but
  // course-preview-viewer.tsx already renders it to arbitrary learners once
  // a course is published.
  title: string;
  order: number;
  config: SlideConfig;
};

export type Lesson = {
  id: string;
  course_version: string;
  title: string;
  description: string;
  order: number;
  slides: Slide[];
};

export type CourseAsset = {
  id: string;
  course_version: string;
  file: string;
  kind: AssetKind;
  uploaded_by: number;
  created_at: string;
};

export type CourseVersion = {
  id: string;
  course: string;
  version_number: number;
  status: CourseVersionStatus;
  transition_style: TransitionStyle;
  created_by: number;
  published_at: string | null;
  created_at: string;
  lessons: Lesson[];
  assets: CourseAsset[];
};

export type Course = {
  id: string;
  name: string;
  description: string;
  created_by: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
  content: "Content",
  multiple_choice: "Multiple Choice",
  missing_word: "Missing Word",
  match_pairs: "Match the Pair",
};
