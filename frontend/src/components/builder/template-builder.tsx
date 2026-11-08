"use client";

import { useRef, useState, useTransition } from "react";
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
import { useUndoRedo, useUndoRedoShortcut } from "@/lib/use-undo-redo";
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

  // Ctrl+Z/Ctrl+Shift+Z — see lib/use-undo-redo.ts. Mirrors
  // course-builder.tsx's identical wiring one level down (sections/
  // questions instead of lessons/slides); there's no canvas/transform
  // case here at all, just field edits and add/delete/reorder.
  const history = useUndoRedo();
  useUndoRedoShortcut(history.undo, history.redo);
  // The value a section-title/question-label Input held when it was last
  // focused — see handleSectionTitleFocus/handleQuestionLabelFocus below.
  // Only these two fields need this: section description and every other
  // question field (help_text, is_required, config, flag_rule) already
  // only commit once per real change (an onBlur-gated Textarea, a
  // checkbox, a picker), so pushing a history entry right in their own
  // change handler is already the right granularity — these two are the
  // plain per-keystroke-onChange <Input>s in this builder.
  const sectionTitleBaselineRef = useRef(new Map<string, string>());
  const questionLabelBaselineRef = useRef(new Map<string, string>());

  const selectedSection = selection ? (sections.find((s) => s.id === selection.sectionId) ?? null) : null;
  const selectedQuestion =
    selection?.type === "question"
      ? (selectedSection?.questions.find((q) => q.id === selection.questionId) ?? null)
      : null;

  // --- Sections: shared "apply" helpers (see course-builder.tsx's
  // identical split for why these exist separately from the live
  // handlers below — undo/redo replay the same apply step the live edit
  // used, rather than re-deriving it). ---

  function applySectionTitle(sectionId: string, title: string) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, title } : s)));
    startTransition(() => {
      updateSection(sectionId, { title }).catch(() => {});
    });
  }

  function applySectionDescription(sectionId: string, description: string) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, description } : s)));
    startTransition(() => {
      updateSection(sectionId, { description }).catch(() => {});
    });
  }

  function applyDeleteSection(sectionId: string) {
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
    setSelection((sel) => (sel?.sectionId === sectionId ? null : sel));
    startTransition(() => {
      deleteSection(sectionId).catch(() => {});
    });
  }

  function applySectionOrder(orderList: { id: string; order: number }[]) {
    const orderById = new Map(orderList.map((o) => [o.id, o.order]));
    setSections((prev) =>
      [...prev]
        .map((s) => (orderById.has(s.id) ? { ...s, order: orderById.get(s.id)! } : s))
        .sort((a, b) => a.order - b.order),
    );
    startTransition(() => {
      reorderSections(orderList).catch(() => {});
    });
  }

  // Undo deletes the just-created section; redo re-creates it (a fresh id
  // every time — see use-undo-redo.ts's module comment on why that's
  // fine). `idBox` tracks whichever id is "live" right now so this
  // round-trips any number of times without going stale.
  function pushSectionCreateHistory(section: Section) {
    const idBox = { current: section.id };
    history.push({
      undo: () => {
        const id = idBox.current;
        setSections((prev) => prev.filter((s) => s.id !== id));
        setSelection((sel) => (sel?.sectionId === id ? null : sel));
        startTransition(() => {
          deleteSection(id).catch(() => {});
        });
      },
      redo: () => {
        startTransition(async () => {
          const recreated = await createSection(initialVersion.id, sections.length);
          idBox.current = recreated.id;
          setSections((prev) => [...prev, recreated]);
          setSelection({ type: "section", sectionId: recreated.id });
        });
      },
    });
  }

  // Full recreate-with-original-content for an undone delete — a
  // section's `order` (and each of its questions' own `order`) is never
  // renumbered when it's removed (deleteSection/deleteQuestion just
  // filter), so the deleted section's own captured `order` puts it
  // straight back where it was; same for each question, recreated in its
  // original order underneath it.
  function pushDeleteSectionHistory(deletedSection: Section) {
    const idBox = { current: deletedSection.id };
    history.push({
      undo: () => {
        startTransition(async () => {
          const recreatedSection = await createSection(initialVersion.id, deletedSection.order);
          idBox.current = recreatedSection.id;
          const restoredSection = await updateSection(recreatedSection.id, {
            title: deletedSection.title,
            description: deletedSection.description,
          });
          const restoredQuestions: Question[] = [];
          for (const originalQuestion of [...deletedSection.questions].sort((a, b) => a.order - b.order)) {
            const recreatedQuestion = await createQuestion(
              restoredSection.id,
              originalQuestion.question_type,
              originalQuestion.order,
            );
            const restoredQuestion = await updateQuestion(recreatedQuestion.id, {
              label: originalQuestion.label,
              help_text: originalQuestion.help_text,
              is_required: originalQuestion.is_required,
              config: originalQuestion.config,
              display_logic: originalQuestion.display_logic,
              flag_rule: originalQuestion.flag_rule,
            });
            restoredQuestions.push(restoredQuestion);
          }
          setSections((prev) => [...prev, { ...restoredSection, questions: restoredQuestions }]);
          setSelection({ type: "section", sectionId: restoredSection.id });
        });
      },
      redo: () => {
        const id = idBox.current;
        setSections((prev) => prev.filter((s) => s.id !== id));
        setSelection((sel) => (sel?.sectionId === id ? null : sel));
        startTransition(() => {
          deleteSection(id).catch(() => {});
        });
      },
    });
  }

  function handleAddSection() {
    startTransition(async () => {
      const section = await createSection(initialVersion.id, sections.length);
      setSections((prev) => [...prev, section]);
      setSelection({ type: "section", sectionId: section.id });
      pushSectionCreateHistory(section);
    });
  }

  function handleSectionTitleFocus(sectionId: string) {
    const section = sections.find((s) => s.id === sectionId);
    if (section) sectionTitleBaselineRef.current.set(sectionId, section.title);
  }

  function handleSectionTitleChange(sectionId: string, title: string) {
    applySectionTitle(sectionId, title);
  }

  // One history entry per focus-to-blur typing session, not per keystroke
  // — see sectionTitleBaselineRef's own comment.
  function handleSectionTitleBlur(sectionId: string) {
    const baseline = sectionTitleBaselineRef.current.get(sectionId);
    sectionTitleBaselineRef.current.delete(sectionId);
    const current = sections.find((s) => s.id === sectionId)?.title;
    if (baseline === undefined || current === undefined || baseline === current) return;
    history.push({
      undo: () => applySectionTitle(sectionId, baseline),
      redo: () => applySectionTitle(sectionId, current),
    });
  }

  function handleSectionDescriptionChange(sectionId: string, description: string) {
    const oldDescription = sections.find((s) => s.id === sectionId)?.description;
    applySectionDescription(sectionId, description);
    if (oldDescription !== undefined && oldDescription !== description) {
      history.push({
        undo: () => applySectionDescription(sectionId, oldDescription),
        redo: () => applySectionDescription(sectionId, description),
      });
    }
  }

  function handleDeleteSection(sectionId: string) {
    const section = sections.find((s) => s.id === sectionId);
    applyDeleteSection(sectionId);
    if (section) pushDeleteSectionHistory(section);
  }

  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldOrder = sections.map((s) => ({ id: s.id, order: s.order }));
    const oldIndex = sections.findIndex((s) => s.id === active.id);
    const newIndex = sections.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(sections, oldIndex, newIndex).map((s, index) => ({ ...s, order: index }));
    const newOrder = reordered.map((s) => ({ id: s.id, order: s.order }));
    applySectionOrder(newOrder);
    history.push({
      undo: () => applySectionOrder(oldOrder),
      redo: () => applySectionOrder(newOrder),
    });
  }

  // --- Questions: shared "apply" helpers ---

  function applyQuestionFields(sectionId: string, questionId: string, data: Partial<Question>) {
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

  function applyDeleteQuestion(sectionId: string, questionId: string) {
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

  function applyQuestionOrder(sectionId: string, orderList: { id: string; order: number }[]) {
    const orderById = new Map(orderList.map((o) => [o.id, o.order]));
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              questions: [...s.questions]
                .map((q) => (orderById.has(q.id) ? { ...q, order: orderById.get(q.id)! } : q))
                .sort((a, b) => a.order - b.order),
            }
          : s,
      ),
    );
    startTransition(() => {
      reorderQuestions(orderList).catch(() => {});
    });
  }

  // Mirrors pushSectionCreateHistory one level down.
  function pushQuestionCreateHistory(sectionId: string, question: Question) {
    const idBox = { current: question.id };
    history.push({
      undo: () => {
        const id = idBox.current;
        setSections((prev) =>
          prev.map((s) => (s.id === sectionId ? { ...s, questions: s.questions.filter((q) => q.id !== id) } : s)),
        );
        setSelection((sel) => (sel?.type === "question" && sel.questionId === id ? null : sel));
        startTransition(() => {
          deleteQuestion(id).catch(() => {});
        });
      },
      redo: () => {
        startTransition(async () => {
          const section = sections.find((s) => s.id === sectionId);
          const recreated = await createQuestion(
            sectionId,
            question.question_type,
            section ? section.questions.length : question.order,
          );
          idBox.current = recreated.id;
          setSections((prev) =>
            prev.map((s) => (s.id === sectionId ? { ...s, questions: [...s.questions, recreated] } : s)),
          );
          setSelection({ type: "question", sectionId, questionId: recreated.id });
        });
      },
    });
  }

  // Mirrors pushDeleteSectionHistory's shape one level down — the
  // deleted question's own captured `order` is enough to put it back in
  // its original position (siblings' own order values are untouched by a
  // plain delete).
  function pushDeleteQuestionHistory(sectionId: string, deletedQuestion: Question) {
    const idBox = { current: deletedQuestion.id };
    history.push({
      undo: () => {
        startTransition(async () => {
          const recreated = await createQuestion(sectionId, deletedQuestion.question_type, deletedQuestion.order);
          idBox.current = recreated.id;
          const restored = await updateQuestion(recreated.id, {
            label: deletedQuestion.label,
            help_text: deletedQuestion.help_text,
            is_required: deletedQuestion.is_required,
            config: deletedQuestion.config,
            display_logic: deletedQuestion.display_logic,
            flag_rule: deletedQuestion.flag_rule,
          });
          setSections((prev) =>
            prev.map((s) => (s.id === sectionId ? { ...s, questions: [...s.questions, restored] } : s)),
          );
          setSelection({ type: "question", sectionId, questionId: restored.id });
        });
      },
      redo: () => {
        const id = idBox.current;
        setSections((prev) =>
          prev.map((s) => (s.id === sectionId ? { ...s, questions: s.questions.filter((q) => q.id !== id) } : s)),
        );
        setSelection((sel) => (sel?.type === "question" && sel.questionId === id ? null : sel));
        startTransition(() => {
          deleteQuestion(id).catch(() => {});
        });
      },
    });
  }

  function handleAddQuestion(sectionId: string, questionType: QuestionType) {
    startTransition(async () => {
      const section = sections.find((s) => s.id === sectionId);
      const order = section ? section.questions.length : 0;
      const question = await createQuestion(sectionId, questionType, order);
      setSections((prev) =>
        prev.map((s) => (s.id === sectionId ? { ...s, questions: [...s.questions, question] } : s)),
      );
      setSelection({ type: "question", sectionId, questionId: question.id });
      pushQuestionCreateHistory(sectionId, question);
    });
  }

  // Covers every question field EXCEPT `label` (config, help_text,
  // is_required, flag_rule) — each of those already only fires once per
  // real change (an onBlur-gated field, a checkbox, a picker committing),
  // so pushing history right here is already the right granularity.
  // `label` goes through handleQuestionLabelChange below instead, which
  // fires on every keystroke and needs the focus/blur coalescing
  // treatment this function deliberately skips.
  function handleQuestionChange(sectionId: string, questionId: string, data: Partial<Question>) {
    const oldQuestion = sections.find((s) => s.id === sectionId)?.questions.find((q) => q.id === questionId);
    applyQuestionFields(sectionId, questionId, data);
    if (!oldQuestion) return;
    const oldData: Partial<Question> = {};
    for (const key of Object.keys(data) as (keyof Question)[]) {
      (oldData as Record<string, unknown>)[key] = oldQuestion[key];
    }
    history.push({
      undo: () => applyQuestionFields(sectionId, questionId, oldData),
      redo: () => applyQuestionFields(sectionId, questionId, data),
    });
  }

  function handleQuestionLabelFocus(sectionId: string, questionId: string) {
    const question = sections.find((s) => s.id === sectionId)?.questions.find((q) => q.id === questionId);
    if (question) questionLabelBaselineRef.current.set(questionId, question.label);
  }

  function handleQuestionLabelChange(sectionId: string, questionId: string, label: string) {
    applyQuestionFields(sectionId, questionId, { label });
  }

  function handleQuestionLabelBlur(sectionId: string, questionId: string) {
    const baseline = questionLabelBaselineRef.current.get(questionId);
    questionLabelBaselineRef.current.delete(questionId);
    const current = sections.find((s) => s.id === sectionId)?.questions.find((q) => q.id === questionId)?.label;
    if (baseline === undefined || current === undefined || baseline === current) return;
    history.push({
      undo: () => applyQuestionFields(sectionId, questionId, { label: baseline }),
      redo: () => applyQuestionFields(sectionId, questionId, { label: current }),
    });
  }

  function handleDeleteQuestion(sectionId: string, questionId: string) {
    const question = sections.find((s) => s.id === sectionId)?.questions.find((q) => q.id === questionId);
    applyDeleteQuestion(sectionId, questionId);
    if (question) pushDeleteQuestionHistory(sectionId, question);
  }

  function handleQuestionDragEnd(sectionId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;
    const questions = [...section.questions].sort((a, b) => a.order - b.order);
    const oldOrder = questions.map((q) => ({ id: q.id, order: q.order }));
    const oldIndex = questions.findIndex((q) => q.id === active.id);
    const newIndex = questions.findIndex((q) => q.id === over.id);
    const reordered = arrayMove(questions, oldIndex, newIndex).map((q, index) => ({ ...q, order: index }));
    const newOrder = reordered.map((q) => ({ id: q.id, order: q.order }));
    applyQuestionOrder(sectionId, newOrder);
    history.push({
      undo: () => applyQuestionOrder(sectionId, oldOrder),
      redo: () => applyQuestionOrder(sectionId, newOrder),
    });
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
                    onTitleFocus={() => handleSectionTitleFocus(section.id)}
                    onTitleBlur={() => handleSectionTitleBlur(section.id)}
                    onDelete={() => handleDeleteSection(section.id)}
                    onDeleteQuestion={(questionId) => handleDeleteQuestion(section.id, questionId)}
                    onQuestionLabelChange={(questionId, label) =>
                      handleQuestionLabelChange(section.id, questionId, label)
                    }
                    onQuestionLabelFocus={(questionId) => handleQuestionLabelFocus(section.id, questionId)}
                    onQuestionLabelBlur={(questionId) => handleQuestionLabelBlur(section.id, questionId)}
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
