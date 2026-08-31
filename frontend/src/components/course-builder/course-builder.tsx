"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  createLesson,
  createSlide,
  deleteLesson,
  deleteSlide,
  publishVersion,
  reorderLessons,
  reorderSlides,
  updateLesson,
  updateSlide,
} from "@/app/actions/courses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Course, CourseVersion, Lesson, Slide, SlideType } from "@/lib/course-types";
import { LessonCard } from "./lesson-card";
import { PropertiesPanel, type PropertiesPanelProps } from "./properties-panel";

type Selection =
  | { type: "lesson"; lessonId: string }
  | { type: "slide"; lessonId: string; slideId: string }
  | null;

export function CourseBuilder({
  course,
  initialVersion,
}: {
  course: Course;
  initialVersion: CourseVersion;
}) {
  const [lessons, setLessons] = useState<Lesson[]>(
    [...initialVersion.lessons].sort((a, b) => a.order - b.order),
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [publishing, setPublishing] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const selectedLesson = selection ? (lessons.find((l) => l.id === selection.lessonId) ?? null) : null;
  const selectedSlide =
    selection?.type === "slide"
      ? (selectedLesson?.slides.find((s) => s.id === selection.slideId) ?? null)
      : null;

  // --- Lessons ---

  function handleAddLesson() {
    startTransition(async () => {
      const lesson = await createLesson(initialVersion.id, lessons.length);
      setLessons((prev) => [...prev, lesson]);
      setSelection({ type: "lesson", lessonId: lesson.id });
    });
  }

  function handleLessonTitleChange(lessonId: string, title: string) {
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, title } : l)));
    startTransition(() => {
      updateLesson(lessonId, { title }).catch(() => {});
    });
  }

  function handleLessonDescriptionChange(lessonId: string, description: string) {
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, description } : l)));
    startTransition(() => {
      updateLesson(lessonId, { description }).catch(() => {});
    });
  }

  function handleDeleteLesson(lessonId: string) {
    setLessons((prev) => prev.filter((l) => l.id !== lessonId));
    setSelection((sel) => (sel?.lessonId === lessonId ? null : sel));
    startTransition(() => {
      deleteLesson(lessonId).catch(() => {});
    });
  }

  function handleLessonDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLessons((prev) => {
      const oldIndex = prev.findIndex((l) => l.id === active.id);
      const newIndex = prev.findIndex((l) => l.id === over.id);
      const reordered = arrayMove(prev, oldIndex, newIndex).map((l, index) => ({ ...l, order: index }));
      startTransition(() => {
        reorderLessons(reordered.map((l) => ({ id: l.id, order: l.order }))).catch(() => {});
      });
      return reordered;
    });
  }

  // --- Slides ---

  function handleAddSlide(lessonId: string, slideType: SlideType) {
    startTransition(async () => {
      const lesson = lessons.find((l) => l.id === lessonId);
      const order = lesson ? lesson.slides.length : 0;
      const slide = await createSlide(lessonId, slideType, order);
      setLessons((prev) =>
        prev.map((l) => (l.id === lessonId ? { ...l, slides: [...l.slides, slide] } : l)),
      );
      setSelection({ type: "slide", lessonId, slideId: slide.id });
    });
  }

  function handleSlideChange(lessonId: string, slideId: string, data: Partial<Slide>) {
    setLessons((prev) =>
      prev.map((l) =>
        l.id === lessonId
          ? { ...l, slides: l.slides.map((s) => (s.id === slideId ? { ...s, ...data } : s)) }
          : l,
      ),
    );
    startTransition(() => {
      updateSlide(slideId, data).catch(() => {});
    });
  }

  function handleDeleteSlide(lessonId: string, slideId: string) {
    setLessons((prev) =>
      prev.map((l) => (l.id === lessonId ? { ...l, slides: l.slides.filter((s) => s.id !== slideId) } : l)),
    );
    setSelection((sel) => (sel?.type === "slide" && sel.slideId === slideId ? null : sel));
    startTransition(() => {
      deleteSlide(slideId).catch(() => {});
    });
  }

  function handleSlideDragEnd(lessonId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLessons((prev) =>
      prev.map((l) => {
        if (l.id !== lessonId) return l;
        const slides = [...l.slides].sort((a, b) => a.order - b.order);
        const oldIndex = slides.findIndex((s) => s.id === active.id);
        const newIndex = slides.findIndex((s) => s.id === over.id);
        const reordered = arrayMove(slides, oldIndex, newIndex).map((s, index) => ({ ...s, order: index }));
        startTransition(() => {
          reorderSlides(reordered.map((s) => ({ id: s.id, order: s.order }))).catch(() => {});
        });
        return { ...l, slides: reordered };
      }),
    );
  }

  // --- Publish ---

  function handlePublish() {
    setPublishing(true);
    startTransition(async () => {
      try {
        await publishVersion(course.id, initialVersion.id);
        router.push(`/courses/${course.id}`);
      } finally {
        setPublishing(false);
      }
    });
  }

  const panelProps: PropertiesPanelProps =
    selectedSlide && selectedLesson
      ? {
          kind: "slide",
          slide: selectedSlide,
          onChange: (data) => handleSlideChange(selectedLesson.id, selectedSlide.id, data),
          onDelete: () => handleDeleteSlide(selectedLesson.id, selectedSlide.id),
        }
      : selectedLesson
        ? {
            kind: "lesson",
            lesson: selectedLesson,
            onDescriptionChange: (v) => handleLessonDescriptionChange(selectedLesson.id, v),
            onDelete: () => handleDeleteLesson(selectedLesson.id),
          }
        : { kind: "empty" };

  const panelKey = selection
    ? selection.type === "lesson"
      ? `lesson-${selection.lessonId}`
      : `slide-${selection.slideId}`
    : "empty";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{course.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Draft</Badge>
            <span>Version {initialVersion.version_number}</span>
          </div>
        </div>
        <Button disabled={publishing} onClick={handlePublish}>
          {publishing ? "Publishing…" : "Publish"}
        </Button>
      </div>

      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1 space-y-4">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleLessonDragEnd}>
            <SortableContext items={lessons.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {lessons.map((lesson) => (
                  <LessonCard
                    key={lesson.id}
                    lesson={lesson}
                    isSelected={selection?.type === "lesson" && selection.lessonId === lesson.id}
                    selectedSlideId={
                      selection?.type === "slide" && selection.lessonId === lesson.id
                        ? selection.slideId
                        : null
                    }
                    onSelect={() => setSelection({ type: "lesson", lessonId: lesson.id })}
                    onSelectSlide={(slideId) =>
                      setSelection({ type: "slide", lessonId: lesson.id, slideId })
                    }
                    onTitleChange={(title) => handleLessonTitleChange(lesson.id, title)}
                    onDelete={() => handleDeleteLesson(lesson.id)}
                    onDeleteSlide={(slideId) => handleDeleteSlide(lesson.id, slideId)}
                    onSlideTitleChange={(slideId, title) =>
                      handleSlideChange(lesson.id, slideId, { title })
                    }
                    onSlideDragEnd={(event) => handleSlideDragEnd(lesson.id, event)}
                    onAddSlide={(type) => handleAddSlide(lesson.id, type)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <Button variant="outline" onClick={handleAddLesson} className="w-full">
            <Plus className="mr-1 h-4 w-4" />
            Add lesson
          </Button>
        </div>

        <div className="sticky top-6 w-80 shrink-0 rounded-lg border-2 border-border bg-card shadow-sm">
          <PropertiesPanel key={panelKey} {...panelProps} />
        </div>
      </div>
    </div>
  );
}
