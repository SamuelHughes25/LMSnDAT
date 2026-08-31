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

// Type-specific slide content. Only the "content" slide_type's shape is
// modeled concretely this stage; the index signature keeps this open for
// the other slide_types' config shapes (options, buckets/items, etc.) added
// in later stages, same approach as QuestionConfig in lib/types.ts.
export type SlideConfig = {
  // content
  body?: string;
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
