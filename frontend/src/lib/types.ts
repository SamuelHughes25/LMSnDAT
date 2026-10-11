// Mirrors backend/apps/templates_app/constants.py and the DRF serializers in
// backend/apps/templates_app/serializers.py — keep these in sync by hand for
// now (no shared schema codegen yet).

export type QuestionType =
  | "text"
  | "number"
  | "boolean"
  | "single_select"
  | "multi_select"
  | "date"
  | "photo"
  | "signature"
  | "gps"
  | "barcode"
  | "section_header"
  | "instruction";

export type TemplateVersionStatus = "draft" | "published" | "archived";

export type SelectOption = { value: string; label: string };

export type QuestionConfig = {
  options?: SelectOption[];
  [key: string]: unknown;
};

export type DisplayLogic = {
  question_id: string;
  operator: "equals" | "not_equals" | "in";
  value: unknown;
} | null;

export type FlagRule = {
  operator: "equals" | "not_equals" | "in";
  value: unknown;
} | null;

export type Question = {
  id: string;
  section: string;
  question_type: QuestionType;
  label: string;
  help_text: string;
  order: number;
  is_required: boolean;
  config: QuestionConfig;
  display_logic: DisplayLogic;
  flag_rule: FlagRule;
};

export type Section = {
  id: string;
  template_version: string;
  title: string;
  description: string;
  order: number;
  questions: Question[];
};

export type TemplateVersion = {
  id: string;
  template: string;
  version_number: number;
  status: TemplateVersionStatus;
  created_by: number;
  published_at: string | null;
  created_at: string;
  sections: Section[];
};

export type Template = {
  id: string;
  name: string;
  description: string;
  // See Course.created_by's identical comment in course-types.ts.
  created_by: number | null;
  created_by_username: string | null;
  is_archived: boolean;
  // See Course.archived_by's identical comment in course-types.ts.
  archived_by: number | null;
  archived_by_username: string | null;
  archived_at: string | null;
  // See Course.owner's identical comment in course-types.ts.
  owner: number;
  owner_username: string;
  editors: number[];
  editor_usernames: string[];
  created_at: string;
  updated_at: string;
};

export type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Yes/No",
  single_select: "Single select",
  multi_select: "Multi select",
  date: "Date",
  photo: "Photo evidence",
  signature: "Signature",
  gps: "GPS / location",
  barcode: "Barcode / QR scan",
  section_header: "Section header",
  instruction: "Instruction block",
};

export const ANSWERABLE_QUESTION_TYPES: QuestionType[] = [
  "text",
  "number",
  "boolean",
  "single_select",
  "multi_select",
  "date",
  "photo",
  "signature",
  "gps",
  "barcode",
];

export const SELECT_QUESTION_TYPES: QuestionType[] = ["single_select", "multi_select"];

// Types whose value can meaningfully drive a flag_rule/display_logic
// "equals" comparison in the builder UI (boolean/select — a free-text
// answer isn't a great fit for a simple equality trigger).
export const CONDITION_CAPABLE_QUESTION_TYPES: QuestionType[] = ["boolean", "single_select"];
