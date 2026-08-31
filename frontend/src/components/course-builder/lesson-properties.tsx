"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Lesson } from "@/lib/course-types";

export function LessonProperties({
  lesson,
  onDescriptionChange,
  onDelete,
}: {
  lesson: Lesson;
  onDescriptionChange: (description: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Lesson</div>
        <div className="mt-0.5 font-medium">{lesson.title}</div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="lesson-description">Description</Label>
        <Textarea
          id="lesson-description"
          defaultValue={lesson.description}
          onBlur={(e) => {
            if (e.target.value !== lesson.description) onDescriptionChange(e.target.value);
          }}
          placeholder="Shown to the learner at the start of this lesson (optional)"
          className="min-h-24"
        />
      </div>

      <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={onDelete}>
        <Trash2 className="mr-1.5 h-4 w-4" />
        Delete lesson
      </Button>
    </div>
  );
}
