"use client";

import { LayoutTemplate, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SlideTemplate } from "@/lib/course-types";
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
// an existing group as a one-line addition, no rewrite. The old "Content"
// group is handled separately, just below — it's the one group that also
// carries the Templates submenu (see onSelectTemplate's own comment).
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
  { label: "Assessment", types: ["multiple_choice", "missing_word", "match_pairs", "sequencing"] },
  { label: "Interactive", types: ["accordion", "flashcards", "hotspot_image"] },
];

// Purely a picker here — renaming/deleting a saved template lives in
// manage-slide-templates-dialog.tsx (opened from the icon button next to
// "Import or manage reusable lessons" in slide-rail.tsx), not in this
// dropdown. Keeping this one single-purpose (pick what to add, close) means
// every row here can stay a plain DropdownMenuItem with no extra
// interactive children fighting it for clicks.
export function AddSlideMenu({
  templates,
  onSelect,
  onSelectTemplate,
}: {
  templates: SlideTemplate[];
  onSelect: (type: SlideType) => void;
  // Imports a saved slide-template's config into a brand-new slide — see
  // the backend's SlideTemplate model and services.import_slide_template.
  // A one-time clone, not a live link, same as onImportLesson's own
  // reusable-lesson equivalent in course-builder.tsx.
  onSelectTemplate: (slideTemplateId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="w-full" />}>
        <Plus className="mr-1 h-4 w-4" />
        Add slide
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {/* Blank "content" slide, renamed to "Empty page" here specifically
            — SLIDE_TYPE_LABELS["content"] stays "Content" everywhere else
            (the slide badge, thumbnails, etc.), since a content slide with
            structured legacy fields (title-table, image-left) is still
            genuinely "Content" there; it's only in THIS menu, next to its
            new Templates sibling, that "Empty page" reads correctly as
            "content, with nothing in it yet." */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Empty page</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onSelect("content")}>
            <SlideTypeIcon type="content" className="text-muted-foreground" />
            Empty page
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <LayoutTemplate className="text-muted-foreground" />
              Templates
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {templates.length === 0 ? (
                <DropdownMenuLabel>Nothing saved yet</DropdownMenuLabel>
              ) : (
                templates.map((template) => (
                  <DropdownMenuItem key={template.id} onClick={() => onSelectTemplate(template.id)}>
                    {/* The template's own slide_type icon, not a generic
                        LayoutTemplate one — a SlideTemplate can be any
                        slide_type now (see course-types.ts's own comment),
                        so this is the only signal in this list telling a
                        "Capitals MC" template apart from a "Capitals MC"
                        title screen. */}
                    <SlideTypeIcon type={template.slide_type} className="text-muted-foreground" />
                    <span className="truncate">{template.name}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>

        {GROUPS.map((group) => (
          <DropdownMenuGroup key={group.label}>
            <DropdownMenuSeparator />
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
