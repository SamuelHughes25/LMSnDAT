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
import type { QuestionType, Section } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AddQuestionMenu } from "./add-question-menu";
import { QuestionRow } from "./question-row";

export function SectionCard({
  section,
  isSelected,
  selectedQuestionId,
  onSelect,
  onSelectQuestion,
  onTitleChange,
  onTitleFocus,
  onTitleBlur,
  onDelete,
  onDeleteQuestion,
  onQuestionLabelChange,
  onQuestionLabelFocus,
  onQuestionLabelBlur,
  onQuestionDragEnd,
  onAddQuestion,
}: {
  section: Section;
  isSelected: boolean;
  selectedQuestionId: string | null;
  onSelect: () => void;
  onSelectQuestion: (questionId: string) => void;
  onTitleChange: (title: string) => void;
  // See template-builder.tsx's sectionTitleBaselineRef comment — this
  // plain per-keystroke Input needs an explicit focus/blur pair to
  // coalesce undo history into one step per edit session.
  onTitleFocus: () => void;
  onTitleBlur: () => void;
  onDelete: () => void;
  onDeleteQuestion: (questionId: string) => void;
  onQuestionLabelChange: (questionId: string, label: string) => void;
  onQuestionLabelFocus: (questionId: string) => void;
  onQuestionLabelBlur: (questionId: string) => void;
  onQuestionDragEnd: (event: DragEndEvent) => void;
  onAddQuestion: (type: QuestionType) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const questions = [...section.questions].sort((a, b) => a.order - b.order);

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
          // Guard against bubbling from the title Input below — see the
          // identical fix (and full explanation) in question-row.tsx.
          if (e.target !== e.currentTarget) return;
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
          aria-label="Drag to reorder section"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Input
          value={section.title}
          onChange={(e) => onTitleChange(e.target.value)}
          onFocus={onTitleFocus}
          onBlur={onTitleBlur}
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
          aria-label="Delete section"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2 border-t border-border p-3 pl-9">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onQuestionDragEnd}>
          <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {questions.map((question) => (
                <QuestionRow
                  key={question.id}
                  question={question}
                  isSelected={selectedQuestionId === question.id}
                  onSelect={() => onSelectQuestion(question.id)}
                  onLabelChange={(label) => onQuestionLabelChange(question.id, label)}
                  onLabelFocus={() => onQuestionLabelFocus(question.id)}
                  onLabelBlur={() => onQuestionLabelBlur(question.id)}
                  onDelete={() => onDeleteQuestion(question.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <AddQuestionMenu onSelect={onAddQuestion} />
      </div>
    </div>
  );
}
