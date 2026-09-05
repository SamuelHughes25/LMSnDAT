"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";

import {
  createQuestion,
  createSection,
  deleteQuestion,
  deleteSection,
  publishVersion,
  reorderQuestions,
  reorderSections,
  updateQuestion,
  updateSection,
} from "@/app/actions/templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Question, QuestionType, Section, Template, TemplateVersion } from "@/lib/types";
import { PropertiesPanel, type PropertiesPanelProps } from "./properties-panel";
import { SectionCard } from "./section-card";

type Selection =
  | { type: "section"; sectionId: string }
  | { type: "question"; sectionId: string; questionId: string }
  | null;

export function TemplateBuilder({
  template,
  initialVersion,
}: {
  template: Template;
  initialVersion: TemplateVersion;
}) {
  const [sections, setSections] = useState<Section[]>(
    [...initialVersion.sections].sort((a, b) => a.order - b.order),
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [publishing, setPublishing] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const selectedSection = selection ? (sections.find((s) => s.id === selection.sectionId) ?? null) : null;
  const selectedQuestion =
    selection?.type === "question"
      ? (selectedSection?.questions.find((q) => q.id === selection.questionId) ?? null)
      : null;

  // --- Sections ---

  function handleAddSection() {
    startTransition(async () => {
      const section = await createSection(initialVersion.id, sections.length);
      setSections((prev) => [...prev, section]);
      setSelection({ type: "section", sectionId: section.id });
    });
  }

  function handleSectionTitleChange(sectionId: string, title: string) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, title } : s)));
    startTransition(() => {
      updateSection(sectionId, { title }).catch(() => {});
    });
  }

  function handleSectionDescriptionChange(sectionId: string, description: string) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, description } : s)));
    startTransition(() => {
      updateSection(sectionId, { description }).catch(() => {});
    });
  }

  function handleDeleteSection(sectionId: string) {
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
    setSelection((sel) => (sel?.sectionId === sectionId ? null : sel));
    startTransition(() => {
      deleteSection(sectionId).catch(() => {});
    });
  }

  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSections((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      const reordered = arrayMove(prev, oldIndex, newIndex).map((s, index) => ({ ...s, order: index }));
      startTransition(() => {
        reorderSections(reordered.map((s) => ({ id: s.id, order: s.order }))).catch(() => {});
      });
      return reordered;
    });
  }

  // --- Questions ---

  function handleAddQuestion(sectionId: string, questionType: QuestionType) {
    startTransition(async () => {
      const section = sections.find((s) => s.id === sectionId);
      const order = section ? section.questions.length : 0;
      const question = await createQuestion(sectionId, questionType, order);
      setSections((prev) =>
        prev.map((s) => (s.id === sectionId ? { ...s, questions: [...s.questions, question] } : s)),
      );
      setSelection({ type: "question", sectionId, questionId: question.id });
    });
  }

  function handleQuestionChange(sectionId: string, questionId: string, data: Partial<Question>) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, questions: s.questions.map((q) => (q.id === questionId ? { ...q, ...data } : q)) }
          : s,
      ),
    );
    startTransition(() => {
      updateQuestion(questionId, data).catch(() => {});
    });
  }

  function handleDeleteQuestion(sectionId: string, questionId: string) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, questions: s.questions.filter((q) => q.id !== questionId) } : s,
      ),
    );
    setSelection((sel) => (sel?.type === "question" && sel.questionId === questionId ? null : sel));
    startTransition(() => {
      deleteQuestion(questionId).catch(() => {});
    });
  }

  function handleQuestionDragEnd(sectionId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s;
        const questions = [...s.questions].sort((a, b) => a.order - b.order);
        const oldIndex = questions.findIndex((q) => q.id === active.id);
        const newIndex = questions.findIndex((q) => q.id === over.id);
        const reordered = arrayMove(questions, oldIndex, newIndex).map((q, index) => ({ ...q, order: index }));
        startTransition(() => {
          reorderQuestions(reordered.map((q) => ({ id: q.id, order: q.order }))).catch(() => {});
        });
        return { ...s, questions: reordered };
      }),
    );
  }

  // --- Publish ---

  function handlePublish() {
    setPublishing(true);
    startTransition(async () => {
      try {
        await publishVersion(template.id, initialVersion.id);
        router.push(`/templates/${template.id}`);
      } finally {
        setPublishing(false);
      }
    });
  }

  const panelProps: PropertiesPanelProps =
    selectedQuestion && selectedSection
      ? {
          kind: "question",
          question: selectedQuestion,
          onChange: (data) => handleQuestionChange(selectedSection.id, selectedQuestion.id, data),
          onDelete: () => handleDeleteQuestion(selectedSection.id, selectedQuestion.id),
        }
      : selectedSection
        ? {
            kind: "section",
            section: selectedSection,
            onDescriptionChange: (v) => handleSectionDescriptionChange(selectedSection.id, v),
            onDelete: () => handleDeleteSection(selectedSection.id),
          }
        : { kind: "empty" };

  const panelKey = selection
    ? selection.type === "section"
      ? `section-${selection.sectionId}`
      : `question-${selection.questionId}`
    : "empty";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link href={`/templates/${template.id}`} aria-label="Back to template" />}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{template.name}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">Draft</Badge>
              <span>Version {initialVersion.version_number}</span>
            </div>
          </div>
        </div>
        <Button disabled={publishing} onClick={handlePublish}>
          {publishing ? "Publishing…" : "Publish"}
        </Button>
      </div>

      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1 space-y-4">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
            <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {sections.map((section) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    isSelected={selection?.type === "section" && selection.sectionId === section.id}
                    selectedQuestionId={
                      selection?.type === "question" && selection.sectionId === section.id
                        ? selection.questionId
                        : null
                    }
                    onSelect={() => setSelection({ type: "section", sectionId: section.id })}
                    onSelectQuestion={(questionId) =>
                      setSelection({ type: "question", sectionId: section.id, questionId })
                    }
                    onTitleChange={(title) => handleSectionTitleChange(section.id, title)}
                    onDelete={() => handleDeleteSection(section.id)}
                    onDeleteQuestion={(questionId) => handleDeleteQuestion(section.id, questionId)}
                    onQuestionLabelChange={(questionId, label) =>
                      handleQuestionChange(section.id, questionId, { label })
                    }
                    onQuestionDragEnd={(event) => handleQuestionDragEnd(section.id, event)}
                    onAddQuestion={(type) => handleAddQuestion(section.id, type)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <Button variant="outline" onClick={handleAddSection} className="w-full">
            <Plus className="mr-1 h-4 w-4" />
            Add section
          </Button>
        </div>

        <div className="sticky top-6 w-80 shrink-0 rounded-lg border-2 border-border bg-card shadow-sm">
          <PropertiesPanel key={panelKey} {...panelProps} />
        </div>
      </div>
    </div>
  );
}
