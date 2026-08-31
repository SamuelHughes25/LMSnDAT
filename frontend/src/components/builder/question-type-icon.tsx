import {
  Calendar,
  Camera,
  CircleDot,
  Hash,
  Heading,
  Info,
  ListChecks,
  MapPin,
  PenLine,
  ScanLine,
  ToggleLeft,
  Type,
  type LucideIcon,
} from "lucide-react";

import type { QuestionType } from "@/lib/types";

const ICONS: Record<QuestionType, LucideIcon> = {
  text: Type,
  number: Hash,
  boolean: ToggleLeft,
  single_select: CircleDot,
  multi_select: ListChecks,
  date: Calendar,
  photo: Camera,
  signature: PenLine,
  gps: MapPin,
  barcode: ScanLine,
  section_header: Heading,
  instruction: Info,
};

export function QuestionTypeIcon({ type, className }: { type: QuestionType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={className} />;
}
