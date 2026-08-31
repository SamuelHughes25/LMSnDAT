"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Section } from "@/lib/types";

export function SectionProperties({
  section,
  onDescriptionChange,
  onDelete,
}: {
  section: Section;
  onDescriptionChange: (description: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Section</div>
        <div className="mt-0.5 font-medium">{section.title}</div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="section-description">Description</Label>
        <Textarea
          id="section-description"
          defaultValue={section.description}
          onBlur={(e) => {
            if (e.target.value !== section.description) onDescriptionChange(e.target.value);
          }}
          placeholder="Shown to the person filling this section out (optional)"
          className="min-h-24"
        />
      </div>

      <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={onDelete}>
        <Trash2 className="mr-1.5 h-4 w-4" />
        Delete section
      </Button>
    </div>
  );
}
