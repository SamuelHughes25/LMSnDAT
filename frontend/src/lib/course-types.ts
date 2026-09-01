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
// one, then fills in that layout's fixed placeholders. Grouped into four
// families in the properties-panel picker (see LAYOUT_CATEGORIES there):
//
//  - Title pages ("title-only", "title-subtitle", "title-top",
//    "title-bottom") — cover/section-divider slides, no body text, differ
//    only in where the title sits and whether a subtitle is present.
//  - Text pages ("title-body", "two-column") — a title plus one or two
//    rich-text body boxes.
//  - Table pages ("title-table") — a title plus a structured table
//    (config.table), not free-form rich text.
//  - Image pages ("image-left", "image-right") — an uploaded image
//    (config.image_url) alongside a rich-text body box, mirroring
//    two-column's split but with a picture on one side.
//
// A free-floating *background* image (drag to reposition, resize to
// resize, always rendered behind whatever the slide shows) is deliberately
// NOT a layout value here — unlike image-left/image-right, it isn't
// specific to the "content" slide type or any particular arrangement of
// text. It's a cross-cutting per-slide setting (config.background_image_*
// below) that applies underneath any slide_type/layout, edited from the
// properties panel's "Edit" section (slide-background-panel.tsx) rather
// than picked from this layout list — the same place future non-content
// slide styling (e.g. a background color) will live.
//
// See slide-faces/content-slide-face.tsx for the arrangement each value
// renders.
export type ContentSlideLayout =
  | "title-body"
  | "two-column"
  | "title-only"
  | "title-subtitle"
  | "title-top"
  | "title-bottom"
  | "title-table"
  | "image-left"
  | "image-right";

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

// A "title-table" layout's structured table. Plain strings only, both for
// headers and cell values — no per-cell rich text, matching the same
// plain-input treatment as multiple_choice's options and match_pairs'
// keyword/definition fields, so the table editor stays a simple grid of
// text inputs rather than a grid of TipTap instances. Every row is expected
// to have exactly `headers.length` cells; the editor in table-field.tsx is
// the sole writer of this shape and keeps that invariant, so there's no
// need to defensively pad/truncate rows when reading it elsewhere.
export type TableConfig = {
  headers: string[];
  rows: string[][];
};

// A saved free-position/size override for one box on a slide (a text box
// via config.box_transforms below, or the background image via its own
// flat background_image_*_pct fields — this shared shape is just the
// natural one for "percentage of container, centered on (x, y)" math, not
// a sign the two features share any runtime state). See
// slide-faces/positionable-box.tsx and slide-faces/image-shared.tsx's
// imageBoxStyle for how this gets turned into CSS.
export type BoxTransform = {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
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
  // Used only when layout is "title-subtitle" — a short single-line field
  // (Enter suppressed, same as `title`) for a byline/name/date under the
  // main title, rather than a full multi-paragraph body. Same sanitized-
  // HTML-string shape and rules as `title`/`body` above.
  subtitle?: string;
  // Used when layout is "image-left"/"image-right" — the uploaded
  // CourseAsset's `file` URL (see uploadCourseAsset in
  // app/actions/courses.ts and slide-faces/image-field.tsx), or null once
  // removed. Deliberately just a URL string, not an asset id: Slide.config
  // already stores every other type-specific value as a literal rather
  // than a cross-reference (same reasoning noted on the CourseAsset model
  // itself), and a slide never needs to look up anything else about the
  // asset.
  image_url?: string | null;
  image_position?: "top" | "bottom" | "left" | "right";
  // Set only once the author drags a resize handle — undefined means
  // "never resized," treated as 100 (fills its container) by
  // image-field.tsx. Percentages of the image's container on each axis
  // independently (not a single uniform "scale" — the resize handles
  // allow stretching that distorts the image's aspect ratio, which is the
  // point). The image box is always CSS-centered on its (x, y) center
  // point, so changing these can never move that center — see the comment
  // on imageBoxStyle in image-shared.tsx for how that's enforced.
  image_width_pct?: number;
  image_height_pct?: number;
  // Used only when layout is "title-table".
  table?: TableConfig;
  // A free-floating background image, independent of slide_type and
  // layout — see the note on ContentSlideLayout above for why this isn't
  // itself a layout value. Edited from the properties panel's "Edit"
  // section (slide-background-panel.tsx: upload/paste, replace, remove);
  // repositioned/resized via on-canvas drag controls
  // (background-image-field.tsx) once set. `background_image_url` is null
  // once removed, undefined if never set. The *_x_pct/_y_pct/_width_pct/
  // _height_pct fields follow the exact same "percentage of container,
  // CSS-centered on (x, y) so resizing can never move the center" shape
  // as image_width_pct/image_height_pct above, just with a draggable
  // center instead of a fixed 50/50 one, and "container" meaning the
  // whole slide rather than a column.
  background_image_url?: string | null;
  background_image_x_pct?: number;
  background_image_y_pct?: number;
  background_image_width_pct?: number;
  background_image_height_pct?: number;
  // Per-field free-position override for this slide's own text boxes
  // (title/subtitle/body/body2) — see slide-faces/positionable-box.tsx.
  // Deliberately independent of background_image_*: a text box being
  // dragged/resized never reads or writes anything about the background
  // image, and vice versa, matching the "separate, not interacting"
  // requirement they were built to. A field with no entry here renders at
  // its layout's normal flex position; once dragged/resized it gets an
  // entry and switches to being drawn at that absolute (x, y, width,
  // height) instead — see PositionableBox for exactly how that switch
  // happens. Cleared (the whole map, not per-field) by the layout picker
  // whenever `layout` changes (properties-panel.tsx's ContentLayoutPicker)
  // — a different layout means different boxes exist/mean different
  // things, so stale coordinates from the old arrangement aren't carried
  // over into the new one.
  box_transforms?: Partial<Record<"title" | "subtitle" | "body" | "body2", BoxTransform>>;
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
