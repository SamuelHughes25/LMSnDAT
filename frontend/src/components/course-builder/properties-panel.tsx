"use client";

import { Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SLIDE_TYPE_LABELS } from "@/lib/course-types";
import type { Lesson, Slide } from "@/lib/course-types";
import { LessonProperties } from "./lesson-properties";
import { ContentSlideEditor } from "./slide-editors/content-slide-editor";

export type PropertiesPanelProps =
  | { kind: "empty" }
  | {
      kind: "lesson";
      lesson: Lesson;
      onDescriptionChange: (description: string) => void;
      onDelete: () => void;
    }
  | {
      kind: "slide";
      slide: Slide;
      onChange: (data: Partial<Slide>) => void;
      onDelete: () => void;
    };

export function PropertiesPanel(props: PropertiesPanelProps) {
  if (props.kind === "empty") {
    return (
      <div className="flex h-40 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a lesson or slide to edit its properties.
      </div>
    );
  }

  if (props.kind === "lesson") {
    return (
      <LessonProperties
        lesson={props.lesson}
        onDescriptionChange={props.onDescriptionChange}
        onDelete={props.onDelete}
      />
    );
  }

  return <SlideProperties slide={props.slide} onChange={props.onChange} onDelete={props.onDelete} />;
}

function SlideProperties({
  slide,
  onChange,
  onDelete,
}: {
  slide: Slide;
  onChange: (data: Partial<Slide>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Slide</div>
        <Badge variant="outline" className="mt-1">
          {SLIDE_TYPE_LABELS[slide.slide_type]}
        </Badge>
      </div>

      {/* Dispatches on slide_type — only "content" exists this stage. A
          later stage can grow this into the Record<SlideType, editor>
          lookup table described for slide-editors/index.ts without
          disturbing this component's shape. */}
      {slide.slide_type === "content" && (
        <ContentSlideEditor config={slide.config} onChange={(config) => onChange({ config })} />
      )}

      <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={onDelete}>
        <Trash2 className="mr-1.5 h-4 w-4" />
        Delete slide
      </Button>
    </div>
  );
}
