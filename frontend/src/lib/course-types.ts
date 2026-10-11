// Mirrors backend/apps/courses/constants.py and the DRF serializers in
// backend/apps/courses/serializers.py — keep these in sync by hand for now
// (no shared schema codegen yet). Split out from lib/types.ts (the
// templates/questions domain) so the two authoring domains stay
// independently legible.

// The literal title app/actions/courses.ts's createSlide gives every new
// slide (a real, non-empty string — not "" — so a slide has *something*
// to display in the rail before the author ever types anything). Exported
// so any "has this slide actually been authored yet?" check (see
// properties-panel.tsx's hasSlideContent) can treat this exact default the
// same as truly empty, rather than as content the author entered —
// confirmed via a real browser that without this, switching a
// freshly-created slide's layout ONCE ALWAYS warned about losing content
// that was never really there, purely because the untouched default title
// itself counted as "content." Kept as one shared constant, not two
// independently-typed "New slide" string literals, so the creation side
// and the detection side can never silently drift apart.
export const DEFAULT_SLIDE_TITLE = "New slide";

// "content", "multiple_choice", "missing_word", "match_pairs", "accordion",
// "flashcards", "sequencing", and "hotspot_image" are buildable so far.
// Typed as a string union (not a single string literal alias) so later
// stages can widen it to also include "categorize" | "survey_rating" |
// "number_slider" | "game_rapid_fire" without touching call sites — mirrors
// backend/apps/courses/constants.py's SlideType enum.
export type SlideType =
  | "content"
  | "multiple_choice"
  | "missing_word"
  | "match_pairs"
  | "accordion"
  | "flashcards"
  | "sequencing"
  | "hotspot_image";

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

// A single accordion section. `body` is deliberately plain text (rendered
// with `white-space: pre-wrap`, never HTML) — not the same rich-text
// treatment as content-slide-face.tsx's `body`. RichTextBody there is
// tightly coupled to SlideTextToolbar's focus-follows-selection wiring and
// to PositionableBox, not reusable per-row as-is, and every other
// structured-list field in this app (multiple_choice options, match_pairs
// keyword/definition, table cells) is plain for the same reason: avoiding a
// grid of per-item TipTap instances. A real trade-off for content as long
// as a 5-step process description, not an oversight — manual line breaks
// plus typed "1."/"2." numbering read fine with pre-wrap.
export type AccordionSection = {
  id: string;
  title: string;
  body: string;
};

// A single flashcard. Plain text both sides, same "avoid a grid of TipTap
// instances" reasoning as AccordionSection's `body` above.
export type FlashcardItem = {
  id: string;
  front: string;
  back: string;
};

// A single sequencing item. There is no separate "correct index" field —
// the AUTHORED ORDER of config.sequence_items IS the correct order, the
// same "the shape itself is the answer key" idea as MissingWordBlank's
// offsets or MatchPair's shared id. Present-mode shuffles a copy of these
// ids for display and scores by comparing the learner's final order back
// against this array's original order.
export type SequencingItem = {
  id: string;
  text: string;
};

// A single hotspot marker on a hotspot_image slide. xPct/yPct are
// percentages of the image's own rendered box (0-100), following the same
// percentage-of-container convention as BoxTransform/imageBoxStyle
// elsewhere in this file — but note this is NOT a BoxTransform: a hotspot
// is a single point, not a resizable box, so there's no width/height here.
// `label` is allowed to be empty — "placed but not yet labeled" is a valid
// mid-authoring state (the author places the pin, then types the label).
export type HotspotMarker = {
  id: string;
  xPct: number;
  yPct: number;
  label: string;
  description?: string;
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

// One of a slide's "extra images" (config.extra_images) — a free-floating,
// draggable/resizable image beyond the single background_image_url, same
// BoxTransform shape the background image and box_transforms already use.
export type ExtraImage = BoxTransform & {
  id: string;
  url: string;
  // Layers-panel label (slide-layers-panel.tsx) — optional, auto-derived
  // ("Image 1", "Image 2"...) by list position when unset, same convention
  // as FreeTextBox.name below.
  name?: string;
};

// A freeform, author-placed text box on a "freeform" content slide (see
// SlideConfig.text_boxes) — the generic, un-specialized replacement for the
// old fixed title/subtitle/body/body2 fields. Deliberately has NONE of
// RichTextTitle's special-casing (no forced single-line/nowrap, no forced
// font-bold, no Enter suppression) — see free-text-box.tsx's own comment
// for why that unification is the actual fix for the "bold does nothing on
// titles" / "bullet list breaks title width" bugs, not a patch applied to
// the legacy fields themselves. Positioned/sized exactly like ExtraImage —
// same BoxTransform shape, same per-object stable id requirement (a
// selection id and React key need something that survives reordering).
export type FreeTextBox = BoxTransform & {
  id: string;
  // Sanitized HTML string, identical contract to the legacy title/body
  // fields (see SlideConfig.body's own comment) — authored by the same
  // TipTap setup, just without the title-specific constraints.
  html: string;
  // Layers-panel label — optional, auto-derived ("Text 1", "Text 2"...) by
  // list position when unset. Deliberately not derived from `html`'s own
  // content (e.g. first few words) — that would change out from under the
  // user as they type, which reads as more confusing than a plain "Text N"
  // placeholder a user can rename if they want something more specific.
  name?: string;
};

// A reference into one of a freeform slide's object arrays (text_boxes or
// extra_images), used ONLY for `SlideConfig.object_order` — see that
// field's own comment for why stacking order needs to exist as an explicit,
// reorderable list rather than being implied by array position within
// text_boxes/extra_images themselves (those arrays' own order is
// creation-order, not necessarily display/stacking order, once a user
// reorders via the layers panel). The background image is deliberately NOT
// representable here — see SlideConfig.background_image_url's own note on
// why it stays a separate, non-reorderable backdrop layer rather than a
// stackable object for this pass. Written to extend cleanly to a future
// `{type: "widget"; id: string}` variant without reworking the ordering/
// panel mechanism, once widgets exist.
export type SlideObjectRef = { type: "text"; id: string } | { type: "image"; id: string };

// The four text boxes a content slide can have — the keys of box_transforms
// below, and the field names positionable-box.tsx/text-object-properties.tsx
// use to namespace a text box's slide-selection-context id
// (`${slideId}:${field}`). Named and exported here (rather than left as an
// inline union, or duplicated as a local type alias in every file that needs
// it) so content-slide-face.tsx and text-object-properties.tsx share one
// definition instead of two that could quietly drift apart.
export type PositionableField = "title" | "subtitle" | "body" | "body2";

// Type-specific slide content. The "content" and "multiple_choice"
// slide_types' shapes are modeled concretely so far; the index signature
// keeps this open for the other slide_types' config shapes (blanks, pairs,
// etc.) added in later stages, same approach as QuestionConfig in
// lib/types.ts.
export type SlideConfig = {
  // content
  //
  // A content slide renders via exactly ONE of two systems, branched on
  // whether `layout` is set at all — see content-slide-face.tsx's own
  // top-of-file comment for the full rationale. In short: `layout` set
  // means the LEGACY fixed-field system below (title/subtitle/body/body2/
  // box_transforms, one of 9 hardcoded ContentSlideLayout presets) — this
  // covers every slide that existed before text_boxes/object_order were
  // introduced, rendered completely unchanged, no migration, no
  // regression risk. `layout` unset means the FREEFORM system
  // (text_boxes/object_order below) — every brand-new content slide from
  // then on. Applying a "Templates" preset from the properties panel does
  // NOT set `layout` — it seeds text_boxes/object_order with a one-time
  // starting arrangement and leaves the slide in freeform mode, since the
  // whole point is that seeded boxes stay ordinary, freely editable
  // objects afterward rather than a locked structural "layout" the slide
  // is pinned to.
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
  // Additional free-floating images beyond the one above — same shape,
  // same drag/resize behavior, just N of them instead of exactly one.
  // Kept as a SEPARATE array rather than folding background_image_url
  // into it as "item 0": this app is treated as production software with
  // real authored content already using background_image_url (see
  // docs/PROJECT_LOG.md's "internal Mitti-replacement" framing) —
  // migrating existing slides' data into a new shape for a purely
  // additive feature (going from exactly one image to "one or more") is
  // a real risk for zero benefit, when leaving the original field alone
  // and adding a second one for the *extra* images does the same job.
  // Each entry needs its own stable `id` (not just an array index) for
  // the same reason every other list-of-objects config in this app has
  // one (match_pairs' pairs, hotspot_image's hotspots, etc.): a
  // selection id and a React key both need something that survives
  // reordering/removal of OTHER entries, which an index doesn't.
  extra_images?: ExtraImage[];
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
  box_transforms?: Partial<Record<PositionableField, BoxTransform>>;
  // Freeform content-slide system — see `layout`'s own comment above for
  // the legacy-vs-freeform branch this pair drives. Both are only ever
  // meaningful together, and only when `layout` is unset.
  //
  // The author-placed text boxes themselves — unordered as far as this
  // array goes (append-only; a box's position in THIS array has no
  // rendering meaning), stable-id'd so object_order/selection/edits can
  // all reference one unambiguously regardless of edits to any other box.
  text_boxes?: FreeTextBox[];
  // Explicit stacking/layers-panel order: index 0 = back-most, last =
  // front-most (array position IS the z-order — no separate numeric
  // z-index field needed, since this array is itself the single source of
  // truth both the renderer and slide-layers-panel.tsx read). A newly
  // added text box or image is always appended (front-most) and removed
  // here the moment it's deleted from text_boxes/extra_images — the two
  // must never drift out of sync, since an orphaned ref would try to
  // render an object that no longer exists.
  object_order?: SlideObjectRef[];
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
  // Also reused by "sequencing" below for the same purpose (an optional
  // prompt line above its list) — the two types never coexist on one
  // slide, so sharing the field name is safe and avoids a near-duplicate.
  instructions?: string;
  pairs?: MatchPair[];
  // accordion
  sections?: AccordionSection[];
  // flashcards
  cards?: FlashcardItem[];
  // sequencing
  // Deliberately not named "items" — backend/apps/courses/constants.py's
  // reserved-but-unbuilt "categorize" slide_type already uses config.items
  // for a different shape (a bucket-sort item list); this app's SlideConfig
  // is one flat namespace shared across every slide_type, so a distinct
  // name keeps the two unambiguous even though there's no runtime
  // collision (a slide is only ever one slide_type at a time).
  sequence_items?: SequencingItem[];
  // hotspot_image
  // A dedicated field, not a reuse of image_url/background_image_url —
  // parallel to why those two are already kept separate from each other:
  // different sizing/rendering story. Unlike image_url (a resizable,
  // stretchable box via image-field.tsx) this image renders at a FIXED
  // content region with object-fit:contain and is never resized/
  // repositioned itself, since hotspot xPct/yPct must map onto a stable,
  // undistorted image. null once removed, undefined if never set — same
  // convention as image_url/background_image_url.
  hotspot_image_url?: string | null;
  hotspots?: HotspotMarker[];
  [key: string]: unknown;
};

// The actual stacking order to render/show-in-the-layers-panel, self-
// healing against `object_order` drifting out of sync with text_boxes/
// extra_images — confirmed as a real, live bug: extra_images could be
// added (slide-background-panel.tsx's old AddImageRow) without ever being
// pushed into object_order, silently making that image un-reorderable and
// invisible to the layers panel even though it still rendered on the
// canvas via its own separate rendering path. Both bugs are fixed at
// their source now, but this stays as a permanent safety net — any
// text_boxes/extra_images entry missing from object_order is appended
// (front-most, same "newly added = front-most" convention as a genuine
// add), and any object_order entry pointing at an object that no longer
// exists is dropped — so a slide can never end up with content that's
// silently unreachable from either the canvas or the layers panel.
export function normalizeObjectOrder(config: SlideConfig): SlideObjectRef[] {
  const textIds = new Set((config.text_boxes ?? []).map((b) => b.id));
  const imageIds = new Set((config.extra_images ?? []).map((i) => i.id));
  const stillExists = (r: SlideObjectRef) => (r.type === "text" ? textIds.has(r.id) : imageIds.has(r.id));
  const order = (config.object_order ?? []).filter(stillExists);
  const known = new Set(order.map((r) => `${r.type}:${r.id}`));
  const missingText = (config.text_boxes ?? [])
    .filter((b) => !known.has(`text:${b.id}`))
    .map((b): SlideObjectRef => ({ type: "text", id: b.id }));
  const missingImages = (config.extra_images ?? [])
    .filter((i) => !known.has(`image:${i.id}`))
    .map((i): SlideObjectRef => ({ type: "image", id: i.id }));
  return [...order, ...missingText, ...missingImages];
}

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

// A saved, standalone copy of a lesson's slides — the "reusable lesson
// library" entry behind save-as-reusable/import (see backend's
// ReusableLesson model for the full "one-time clone, not a live link"
// rationale). `name`/`description` are the library entry's own label,
// independent of whatever the source lesson was titled at save time.
// `slide_count` only (not the slides themselves) — the manage/import
// dialog only needs to show a count per entry, keeping that list light;
// the actual slides only ever move server-side on import.
export type ReusableLesson = {
  id: string;
  name: string;
  description: string;
  created_by: number;
  created_at: string;
  updated_at: string;
  slide_count: number;
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
  created_by_username: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  lessons: Lesson[];
  assets: CourseAsset[];
};

export type Course = {
  id: string;
  name: string;
  description: string;
  // A course-level picture — set at creation (new-course-dialog.tsx) or
  // later (course-thumbnail-settings.tsx), independent of any particular
  // draft/published CourseVersion (unlike a slide's background_image_url,
  // which lives on a specific version). Null is the common case for any
  // course created before this field existed, or one nobody's bothered to
  // set a picture for — every renderer must treat that as "show a plain
  // placeholder," never an error.
  thumbnail: string | null;
  // Purely historical ("who originally clicked New Course") — null once
  // that user is deleted (SET_NULL, not PROTECT: unlike owner below, this
  // is never what determines whether a user can be removed), and —
  // unlike `owner` — never changes again once set, not even across a
  // transfer_ownership. `owner` is the field that actually represents
  // "who's in charge of this course now"; this is the permanent record
  // of who it originally belonged to, rendered on the Ownership card
  // (content-ownership-card.tsx) as "Originally created by."
  created_by: number | null;
  created_by_username: string | null;
  is_archived: boolean;
  // Who archived this course and when — null unless is_archived (cleared
  // on restore). Read-only: these only ever change via the archive/
  // restore/purge actions in actions/courses.ts, never a plain PATCH.
  archived_by: number | null;
  archived_by_username: string | null;
  archived_at: string | null;
  // Transferable — see transferCourseOwnership in actions/courses.ts.
  // Determines real edit rights (apps.core.permissions
  // .IsContentOwnerEditorOrAdmin on the backend) without needing the
  // admin role, and is what UserViewSet.purge checks before blocking
  // deletion of a content-owning user. Read-only here: only ever changes
  // via transferCourseOwnership/setCourseEditors, never a plain PATCH.
  owner: number;
  owner_username: string;
  editors: number[];
  editor_usernames: string[];
  // Marks this course as a scored assessment rather than free-form
  // training content. passing_score (0-100) is only meaningful when this
  // is true — see backend/apps/courses/models.py's Course model and
  // grading.py for how a CourseAttempt's score/passed are derived from
  // these. Server-authoritative: never computed or trusted from anything
  // the operative's browser sends.
  is_assessment: boolean;
  passing_score: number | null;
  // The default due date for this assessment — only meaningful when
  // is_assessment is true, same convention as passing_score. Prefer
  // my_deadline below for "what's MY actual deadline" — this is just the
  // course-wide default, before any personal extension is applied.
  deadline: string | null;
  // The REQUESTING user's own effective deadline (their own extension if
  // they have one, else `deadline` above) — server-computed, this is the
  // field the portal side should actually check/display, never `deadline`
  // directly. Null if there's no deadline at all, or for an admin/manager
  // request context where "my deadline" isn't meaningful.
  my_deadline: string | null;
  created_at: string;
  updated_at: string;
};

// A course directly assigned to one specific user, independent of Group
// membership (see accounts-types.ts's Group.courses for the indirect
// path) — the two mechanisms freely coexist, including overlapping (a
// user can hold this AND be in one or more Groups that also contain the
// course; that's expected, not an error — see the Members tab, which
// never cross-checks the two against each other). `username`/`course_name`
// are read-only conveniences from the backend so the Members tab table
// doesn't need extra round-trips per row.
export type CourseAssignment = {
  id: string;
  course: string;
  course_name: string;
  user: number;
  username: string;
  assigned_by: number;
  created_at: string;
};

export const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
  content: "Content",
  multiple_choice: "Multiple Choice",
  missing_word: "Missing Word",
  match_pairs: "Match the Pair",
  accordion: "Dropdown / Accordion",
  flashcards: "Flashcards",
  sequencing: "Sequencing",
  hotspot_image: "Hotspot Image",
};
