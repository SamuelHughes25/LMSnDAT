import { FileText, type LucideIcon } from "lucide-react";

import type { SlideType } from "@/lib/course-types";

// One entry today (only "content" is buildable), but kept as a Record so
// adding a slide_type later is a one-line addition here, same shape as
// builder/question-type-icon.tsx.
const ICONS: Record<SlideType, LucideIcon> = {
  content: FileText,
};

export function SlideTypeIcon({ type, className }: { type: SlideType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={className} />;
}
