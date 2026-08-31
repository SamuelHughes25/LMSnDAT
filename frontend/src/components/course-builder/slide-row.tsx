"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SLIDE_TYPE_LABELS } from "@/lib/course-types";
import type { Slide } from "@/lib/course-types";
import { cn } from "@/lib/utils";
import { SlideTypeIcon } from "./slide-type-icon";

export function SlideRow({
  slide,
  isSelected,
  onSelect,
  onTitleChange,
  onDelete,
}: {
  slide: Slide;
  isSelected: boolean;
  onSelect: () => void;
  onTitleChange: (title: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "flex items-center gap-2 rounded-md border p-2",
        isSelected ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="cursor-grab touch-none text-muted-foreground"
        aria-label="Drag to reorder slide"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <SlideTypeIcon type={slide.slide_type} className="h-4 w-4 shrink-0 text-muted-foreground" />

      <Input
        value={slide.title}
        onChange={(e) => onTitleChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        placeholder="Untitled slide"
        className="h-7 flex-1 border-transparent bg-transparent shadow-none focus-visible:border-input focus-visible:bg-background"
      />

      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {SLIDE_TYPE_LABELS[slide.slide_type]}
      </span>

      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Delete slide"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
