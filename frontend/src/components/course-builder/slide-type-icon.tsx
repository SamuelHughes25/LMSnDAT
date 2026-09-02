import {
  ChevronsUpDown,
  FileText,
  Layers,
  Link2,
  ListChecks,
  ListOrdered,
  MapPin,
  TextCursorInput,
  type LucideIcon,
} from "lucide-react";

import type { SlideType } from "@/lib/course-types";

// Eight entries today (see course-types.ts's SlideType union for which are
// buildable), kept as a Record so adding a slide_type later is a one-line
// addition here, same shape as builder/question-type-icon.tsx.
const ICONS: Record<SlideType, LucideIcon> = {
  content: FileText,
  multiple_choice: ListChecks,
  missing_word: TextCursorInput,
  match_pairs: Link2,
  accordion: ChevronsUpDown,
  flashcards: Layers,
  sequencing: ListOrdered,
  hotspot_image: MapPin,
};

export function SlideTypeIcon({ type, className }: { type: SlideType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={className} />;
}
