"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SLIDE_TYPE_LABELS } from "@/lib/course-types";
import type { SlideType } from "@/lib/course-types";
import { SlideTypeIcon } from "./slide-type-icon";

// Grouped by category (mirrors builder/add-question-menu.tsx's Base UI
// dropdown pattern — `render`/`onClick`, never `asChild`/`onSelect`, per
// this project's Base UI (not Radix) shadcn install). Each group lists only
// slide_types that are actually buildable — "game_rapid_fire" and any other
// enum-only type stay excluded until built, same convention
// slide-type-icon.tsx and course-types.ts already follow. Structured as
// named groups (not one flat list) so a future buildable type can slot into
// an existing group as a one-line addition, no rewrite.
// "Interactive" (accordion, flashcards, hotspot_image) is kept separate
// from "Assessment" (multiple_choice, missing_word, match_pairs,
// sequencing) since the two are genuinely different in kind: everything in
// "Assessment" has a real correct answer and reports a score;
// "Interactive" types are self-paced reveal/study content with no
// correctness concept, reported as completion only (see
// slide-interaction.ts's doc comment). sequencing joins "Assessment" — it
// IS scored (fraction of items in the correct final position), same as the
// other three there.
const GROUPS: { label: string; types: SlideType[] }[] = [
  { label: "Content", types: ["content"] },
  { label: "Assessment", types: ["multiple_choice", "missing_word", "match_pairs", "sequencing"] },
  { label: "Interactive", types: ["accordion", "flashcards", "hotspot_image"] },
];

export function AddSlideMenu({ onSelect }: { onSelect: (type: SlideType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="w-full" />}>
        <Plus className="mr-1 h-4 w-4" />
        Add slide
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {GROUPS.map((group, index) => (
          <DropdownMenuGroup key={group.label}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.types.map((type) => (
              <DropdownMenuItem key={type} onClick={() => onSelect(type)}>
                <SlideTypeIcon type={type} className="text-muted-foreground" />
                {SLIDE_TYPE_LABELS[type]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
