import { FileText, ListChecks, type LucideIcon } from "lucide-react";

import type { SlideType } from "@/lib/course-types";

// Two entries today ("content", "multiple_choice" are buildable), kept as a
// Record so adding a slide_type later is a one-line addition here, same
// shape as builder/question-type-icon.tsx.
const ICONS: Record<SlideType, LucideIcon> = {
  content: FileText,
  multiple_choice: ListChecks,
};

export function SlideTypeIcon({ type, className }: { type: SlideType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={className} />;
}
