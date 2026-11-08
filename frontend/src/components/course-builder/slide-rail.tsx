"use client";

import { useState } from "react";
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
import { BookmarkPlus, ChevronDown, ChevronRight, GripVertical, LayoutTemplate, Library, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Lesson, SlideTemplate, SlideType } from "@/lib/course-types";
import { restrictToParentElement, restrictToVerticalAxis } from "@/lib/dnd-modifiers";
import { cn } from "@/lib/utils";
import { AddSlideMenu } from "./add-slide-menu";
import { ManageLessonsDialog } from "./manage-lessons-dialog";
import { ManageSlideTemplatesDialog } from "./manage-slide-templates-dialog";
import { SaveLessonDialog } from "./save-lesson-dialog";
import { SlideThumbnail } from "./slide-thumbnail";

// The whole left rail: lessons as collapsible sections (drag handle +
// inline-editable title + delete), each containing its own nested
// DndContext/SortableContext of slide thumbnails, mirroring the two-level
// DnD nesting the old lesson-card.tsx used (separate SortableContexts can't
// resolve `over` across each other, so cross-lesson slide dragging still
// isn't supported).
export function SlideRail({
  lessons,
  slideTemplates,
  selectedLessonId,
  selectedSlideId,
  onSelectLesson,
  onSelectSlide,
  onLessonTitleChange,
  onLessonTitleFocus,
  onLessonTitleBlur,
  onDeleteLesson,
  onDeleteSlide,
  onSlideDragEnd,
  onLessonDragEnd,
  onAddSlide,
  onImportSlideTemplate,
  onRenameSlideTemplate,
  onReorderSlideTemplates,
  onDeleteSlideTemplate,
  onAddLesson,
  onSaveLessonAsReusable,
  onImportLesson,
}: {
  lessons: Lesson[];
  slideTemplates: SlideTemplate[];
  selectedLessonId: string | null;
  selectedSlideId: string | null;
  onSelectLesson: (lessonId: string) => void;
  onSelectSlide: (lessonId: string, slideId: string) => void;
  onLessonTitleChange: (lessonId: string, title: string) => void;
  // See course-builder.tsx's lessonTitleBaselineRef comment — this is the
  // one plain per-keystroke text input in the builder, so it's the one
  // that needs an explicit focus/blur pair to coalesce undo history into
  // one step per edit session instead of one per character.
  onLessonTitleFocus: (lessonId: string) => void;
  onLessonTitleBlur: (lessonId: string) => void;
  onDeleteLesson: (lessonId: string) => void;
  onDeleteSlide: (lessonId: string, slideId: string) => void;
  onSlideDragEnd: (lessonId: string, event: DragEndEvent) => void;
  onLessonDragEnd: (event: DragEndEvent) => void;
  onAddSlide: (lessonId: string, type: SlideType) => void;
  onImportSlideTemplate: (lessonId: string, slideTemplateId: string) => void;
  onRenameSlideTemplate: (slideTemplateId: string, name: string) => Promise<void>;
  onReorderSlideTemplates: (reordered: SlideTemplate[]) => void;
  onDeleteSlideTemplate: (slideTemplateId: string) => Promise<void>;
  onAddLesson: () => void;
  onSaveLessonAsReusable: (lessonId: string, name: string, description: string) => Promise<void>;
  onImportLesson: (reusableLessonId: string) => Promise<void>;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onLessonDragEnd}>
          <SortableContext items={lessons.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            {lessons.map((lesson) => (
              <LessonSection
                key={lesson.id}
                lesson={lesson}
                isSelected={selectedLessonId === lesson.id}
                selectedSlideId={selectedSlideId}
                onSelect={() => onSelectLesson(lesson.id)}
                onSelectSlide={(slideId) => onSelectSlide(lesson.id, slideId)}
                onTitleChange={(title) => onLessonTitleChange(lesson.id, title)}
                onTitleFocus={() => onLessonTitleFocus(lesson.id)}
                onTitleBlur={() => onLessonTitleBlur(lesson.id)}
                onDelete={() => onDeleteLesson(lesson.id)}
                onDeleteSlide={(slideId) => onDeleteSlide(lesson.id, slideId)}
                onSlideDragEnd={(event) => onSlideDragEnd(lesson.id, event)}
                onAddSlide={(type) => onAddSlide(lesson.id, type)}
                slideTemplates={slideTemplates}
                onImportSlideTemplate={(slideTemplateId) => onImportSlideTemplate(lesson.id, slideTemplateId)}
                onSaveAsReusable={(name, description) => onSaveLessonAsReusable(lesson.id, name, description)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="outline" onClick={onAddLesson} className="flex-1">
          <Plus className="mr-1 h-4 w-4" />
          Add lesson
        </Button>
        <Button
          variant="outline"
          onClick={() => setManageDialogOpen(true)}
          aria-label="Import or manage reusable lessons"
          title="Import or manage reusable lessons"
        >
          <Library className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          onClick={() => setManageTemplatesOpen(true)}
          aria-label="Manage slide templates"
          title="Manage slide templates"
        >
          <LayoutTemplate className="h-4 w-4" />
        </Button>
      </div>

      <ManageLessonsDialog open={manageDialogOpen} onOpenChange={setManageDialogOpen} onImport={onImportLesson} />
      <ManageSlideTemplatesDialog
        open={manageTemplatesOpen}
        onOpenChange={setManageTemplatesOpen}
        templates={slideTemplates}
        onRename={onRenameSlideTemplate}
        onReorder={onReorderSlideTemplates}
        onDelete={onDeleteSlideTemplate}
      />
    </div>
  );
}

function LessonSection({
  lesson,
  isSelected,
  selectedSlideId,
  onSelect,
  onSelectSlide,
  onTitleChange,
  onTitleFocus,
  onTitleBlur,
  onDelete,
  onDeleteSlide,
  onSlideDragEnd,
  onAddSlide,
  slideTemplates,
  onImportSlideTemplate,
  onSaveAsReusable,
}: {
  lesson: Lesson;
  isSelected: boolean;
  selectedSlideId: string | null;
  onSelect: () => void;
  onSelectSlide: (slideId: string) => void;
  onTitleChange: (title: string) => void;
  onTitleFocus: () => void;
  onTitleBlur: () => void;
  onDelete: () => void;
  onDeleteSlide: (slideId: string) => void;
  onSlideDragEnd: (event: DragEndEvent) => void;
  onAddSlide: (type: SlideType) => void;
  slideTemplates: SlideTemplate[];
  onImportSlideTemplate: (slideTemplateId: string) => void;
  onSaveAsReusable: (name: string, description: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lesson.id });
  // Own nested DndContext/SortableContext for this lesson's slides — same
  // reason cross-lesson slide dragging isn't (and can't be) supported yet:
  // separate SortableContexts can't resolve `over` across each other.
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
      <div className="flex items-center gap-1 p-2" role="button" tabIndex={0} onClick={onSelect} onKeyDown={(e) => {
        // Guard against bubbling from the title Input below — see the
        // identical fix (and full explanation) in question-row.tsx.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-label={expanded ? "Collapse lesson" : "Expand lesson"}
          className="text-muted-foreground"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
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
          onFocus={onTitleFocus}
          onBlur={onTitleBlur}
          onClick={(e) => e.stopPropagation()}
          className="h-7 flex-1 border-transparent bg-transparent text-sm font-medium shadow-none focus-visible:border-input focus-visible:bg-background"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            setSaveDialogOpen(true);
          }}
          aria-label="Save as reusable lesson"
          title="Save as reusable lesson"
          className="h-7 w-7"
        >
          <BookmarkPlus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Delete lesson"
          className="h-7 w-7"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <SaveLessonDialog
        lesson={lesson}
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        onSave={onSaveAsReusable}
      />

      {expanded && (
        <div className="space-y-2 border-t border-border p-2">
          {/* modifiers keep a dragged slide's own visual position confined
              to this lesson's own slide-list div (dnd-kit's
              containerNodeRect — the dragged item's own DOM parent, which
              here is exactly the "flex flex-col gap-2" div two lines
              below) and moving vertically only — without this, dragging a
              slide let it visually follow the pointer anywhere on the
              screen, well outside the lesson it belongs to, before
              dropping back into place on release. Reordering itself
              (onSlideDragEnd, driven by onDragEnd/collision detection) is
              unaffected either way — these only constrain the drag's own
              visual transform, not which slide ends up `over` on drop. */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onSlideDragEnd}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {slides.map((slide, index) => (
                  <SlideThumbnail
                    key={slide.id}
                    slide={slide}
                    index={index}
                    isSelected={selectedSlideId === slide.id}
                    onSelect={() => onSelectSlide(slide.id)}
                    onDelete={() => onDeleteSlide(slide.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <AddSlideMenu templates={slideTemplates} onSelect={onAddSlide} onSelectTemplate={onImportSlideTemplate} />
        </div>
      )}
    </div>
  );
}
