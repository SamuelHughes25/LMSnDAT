// Mirrors backend/apps/courses/constants.py and the DRF serializers in
// backend/apps/courses/serializers.py — keep these in sync by hand for now
// (no shared schema codegen yet). Split out from lib/types.ts (the
// templates/questions domain) so the two authoring domains stay
// independently legible.

// Only "content" is buildable so far (Stage 2). Typed as a string union
// (not a single string literal alias) so later stages can widen it to
// "content" | "multiple_choice" | "categorize" | "survey_rating" |
// "number_slider" | "game_rapid_fire" without touching call sites — mirrors
// backend/apps/courses/constants.py's SlideType enum.
export type SlideType = "content";

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

// Type-specific slide content. Only the "content" slide_type's shape is
// modeled concretely this stage; the index signature keeps this open for
// the other slide_types' config shapes (options, buckets/items, etc.) added
// in later stages, same approach as QuestionConfig in lib/types.ts.
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
  [key: string]: unknown;
};

export type Slide = {
  id: string;
  lesson: string;
  slide_type: SlideType;
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
};
