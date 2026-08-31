"use client";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Lesson, SlideType } from "@/lib/course-types";
import { cn } from "@/lib/utils";
import { AddSlideMenu } from "./add-slide-menu";
import { SlideRow } from "./slide-row";

export function LessonCard({
  lesson,
  isSelected,
  selectedSlideId,
  onSelect,
  onSelectSlide,
  onTitleChange,
  onDelete,
  onDeleteSlide,
  onSlideTitleChange,
  onSlideDragEnd,
  onAddSlide,
}: {
  lesson: Lesson;
  isSelected: boolean;
  selectedSlideId: string | null;
  onSelect: () => void;
  onSelectSlide: (slideId: string) => void;
  onTitleChange: (title: string) => void;
  onDelete: () => void;
  onDeleteSlide: (slideId: string) => void;
  onSlideTitleChange: (slideId: string, title: string) => void;
  onSlideDragEnd: (event: DragEndEvent) => void;
  onAddSlide: (type: SlideType) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lesson.id });
  // Own nested DndContext/SortableContext for this lesson's slides — the
  // reason cross-lesson slide dragging isn't (and can't be) supported yet:
  // separate SortableContexts can't resolve `over` across each other.
  // Mirrors builder/section-card.tsx exactly.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const slides = [...lesson.slides].sort((a, b) => a.order - b.order);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("rounded-lg border-2 bg-card shadow-sm", isSelected ? "border-primary" : "border-border")}
    >
      <div
        className="flex items-center gap-2 p-3"
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab touch-none text-muted-foreground"
          aria-label="Drag to reorder lesson"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Input
          value={lesson.title}
          onChange={(e) => onTitleChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="h-8 flex-1 border-transparent bg-transparent text-base font-medium shadow-none focus-visible:border-input focus-visible:bg-background"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Delete lesson"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2 border-t border-border p-3 pl-9">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSlideDragEnd}>
          <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {slides.map((slide) => (
                <SlideRow
                  key={slide.id}
                  slide={slide}
                  isSelected={selectedSlideId === slide.id}
                  onSelect={() => onSelectSlide(slide.id)}
                  onTitleChange={(title) => onSlideTitleChange(slide.id, title)}
                  onDelete={() => onDeleteSlide(slide.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <AddSlideMenu onSelect={onAddSlide} />
      </div>
    </div>
  );
}
