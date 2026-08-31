import { FileText, Link2, ListChecks, TextCursorInput, type LucideIcon } from "lucide-react";

import type { SlideType } from "@/lib/course-types";

// Four entries today ("content", "multiple_choice", "missing_word",
// "match_pairs" are buildable), kept as a Record so adding a slide_type
// later is a one-line addition here, same shape as
// builder/question-type-icon.tsx.
const ICONS: Record<SlideType, LucideIcon> = {
  content: FileText,
  multiple_choice: ListChecks,
  missing_word: TextCursorInput,
  match_pairs: Link2,
};

export function SlideTypeIcon({ type, className }: { type: SlideType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={className} />;
}
