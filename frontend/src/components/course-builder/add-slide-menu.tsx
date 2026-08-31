"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SlideType } from "@/lib/course-types";

// Stage 2 only has one buildable slide_type ("content"), so this is a plain
// button rather than a dropdown. Kept as a single exported component with
// an onSelect(SlideType) callback so a later stage can swap the body for a
// DropdownMenu (mirroring builder/add-question-menu.tsx, Base UI `render`/
// `onClick`) without changing anything at the call site.
export function AddSlideMenu({ onSelect }: { onSelect: (type: SlideType) => void }) {
  return (
    <Button variant="outline" size="sm" onClick={() => onSelect("content")} className="w-full">
      <Plus className="mr-1 h-4 w-4" />
      Add slide
    </Button>
  );
}
