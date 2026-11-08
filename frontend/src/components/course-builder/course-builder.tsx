"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { ArrowLeft } from "lucide-react";

import {
  createLesson,
  createSlide,
  deleteLesson,
  deleteSlide,
  deleteSlideTemplate,
  importReusableLesson,
  importSlideTemplate,
  listSlideTemplates,
  publishVersion,
  renameSlideTemplate,
  reorderLessons,
  reorderSlides,
  reorderSlideTemplates,
  saveLessonAsReusable,
  saveSlideAsTemplate,
  updateLesson,
  updateSlide,
} from "@/app/actions/courses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Course, CourseVersion, Lesson, Slide, SlideConfig, SlideTemplate, SlideType } from "@/lib/course-types";
import { useUndoRedo, useUndoRedoShortcut } from "@/lib/use-undo-redo";
import { ActiveEditorProvider, useActiveEditorContext } from "./active-editor-context";
import { CourseEditLockGate } from "./course-edit-lock-gate";
import { PropertiesPanel, type PropertiesPanelProps, type SelectedObject } from "./properties-panel";
import { GroupDragProvider } from "./slide-faces/group-drag-context";
import { SlideCanvas } from "./slide-canvas";
import { SlideRail } from "./slide-rail";
import { SlideSelectionProvider, useSlideSelection } from "./slide-selection-context";
import { SnapGuideProvider } from "./snap-guide-context";
import { TextBoxPlacementProvider } from "./text-box-placement-context";

type Selection =
  | { type: "lesson"; lessonId: string }
  | { type: "slide"; lessonId: string; slideId: string }
  | null;

// Parses slide-selection-context.tsx's own `${slideId}:${field}` /
// `${slideId}:background-image` / `${slideId}:extra-image:${id}` id shapes
// back into a structured SelectedObject, scoped to one specific slide — a
// selectedId belonging to a DIFFERENT (e.g. previously viewed) slide simply
// won't match this prefix and correctly falls through to null, no separate
// "is this stale" check needed (see slide-selection-context.tsx's own
// comment on why namespacing already makes stale ids harmless).
function parseSelectedObject(selectedId: string | null, slideId: string | undefined): SelectedObject | null {
  if (!selectedId || !slideId) return null;
  const prefix = `${slideId}:`;
  if (!selectedId.startsWith(prefix)) return null;
  const suffix = selectedId.slice(prefix.length);
  if (suffix === "title" || suffix === "subtitle" || suffix === "body" || suffix === "body2") {
    return { type: "text", field: suffix };
  }
  if (suffix === "background-image") return { type: "background-image" };
  if (suffix.startsWith("extra-image:")) {
    return { type: "extra-image", imageId: suffix.slice("extra-image:".length) };
  }
  // A freeform content slide's own text_boxes[] entry — see
  // free-text-box.tsx/free-text-box-properties.tsx, which both namespace
  // their own PositionableBox/ActiveEditorContext ids this same way
  // (`${slideId}:text:${boxId}`).
  if (suffix.startsWith("text:")) {
    return { type: "free-text", boxId: suffix.slice("text:".length) };
  }
  return null;
}

// The public export just sets up the two contexts the inner component (and
// every descendant under SlideCanvas/SlideRail) needs — ActiveEditorProvider
// and SlideSelectionProvider — and renders CourseBuilderInner as their
// child. This split exists specifically so CourseBuilderInner can call
// useSlideSelection()/useActiveEditorContext() itself (to read which object
// is selected and where the panel's own DOM node is): a component can only
// consume a context provided by an ANCESTOR, never one it renders itself as
// part of its own JSX, so the actual builder body has to live one level
// below these providers, not alongside them.
export function CourseBuilder(props: { course: Course; initialVersion: CourseVersion }) {
  return (
    <CourseEditLockGate courseId={props.course.id} courseName={props.course.name}>
      <ActiveEditorProvider>
        <SlideSelectionProvider>
          <SnapGuideProvider>
            <TextBoxPlacementProvider>
              <CourseBuilderInner {...props} />
            </TextBoxPlacementProvider>
          </SnapGuideProvider>
        </SlideSelectionProvider>
      </ActiveEditorProvider>
    </CourseEditLockGate>
  );
}

function CourseBuilderInner({
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
  const [publishError, setPublishError] = useState<string | null>(null);
  // The slide-template library (see add-slide-menu.tsx's own Templates
  // submenu) — fetched once on mount, like the course's lessons themselves,
  // and refetched after a save so a template saved THIS session shows up
  // in the menu without a full page reload. Starts empty rather than
  // undefined/null: an empty Templates submenu ("Nothing saved yet") is a
  // perfectly valid, renderable state, not a loading one worth gating on.
  const [slideTemplates, setSlideTemplates] = useState<SlideTemplate[]>([]);
  const [, startTransition] = useTransition();
  const { selectedIds } = useSlideSelection();
  // The Properties panel only ever shows ONE object's own controls at a
  // time — bulk-editing properties across a multi-selection was explicitly
  // out of scope for this feature (see group-drag-context.tsx's own
  // comment: multi-select here is scoped to moving objects together, not
  // editing them together). With 0 or 2+ objects selected, this falls
  // back to null, which parseSelectedObject below already treats as "no
  // object selected" — the panel falls back to the slide-level view, same
  // as it already does the moment nothing on the canvas is selected.
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : null;
  const { panelRef } = useActiveEditorContext();
  const router = useRouter();

  // Ctrl+Z/Ctrl+Shift+Z for every mutating handler below — see
  // lib/use-undo-redo.ts for the stack itself (and why it defers to a
  // focused TipTap editor's own local undo instead of competing with it).
  const history = useUndoRedo();
  useUndoRedoShortcut(history.undo, history.redo);
  // The value a lesson's title Input held when it was last focused — see
  // handleLessonTitleFocus/handleLessonTitleBlur below. Only that field
  // needs this: slide titles and lesson descriptions already only commit
  // on blur (RichTextTitle's onCommit / LessonProperties' uncontrolled
  // Textarea onBlur), so pushing one history entry right in their own
  // change handler is already the right granularity for those — this
  // field is the one plain per-keystroke-onChange <Input> in the builder.
  const lessonTitleBaselineRef = useRef(new Map<string, string>());

  useEffect(() => {
    listSlideTemplates().then(setSlideTemplates).catch(() => {});
  }, []);

  // Latest known config per slide, read/written OUTSIDE React's render
  // cycle — see handleSlideConfigChange below for why. Refs must never be
  // written during render (React flags it, and it can silently break under
  // concurrent rendering), so this is populated lazily, only inside that
  // handler — a slide's first-ever edit in a session falls back to reading
  // `lessons` state directly (a plain closure read, safe in an event
  // handler), and every edit after that reads its own prior result back
  // out of the ref instead.
  const slideConfigRef = useRef(new Map<string, SlideConfig>());

  const selectedLesson = selection ? (lessons.find((l) => l.id === selection.lessonId) ?? null) : null;
  const selectedSlide =
    selection?.type === "slide"
      ? (selectedLesson?.slides.find((s) => s.id === selection.slideId) ?? null)
      : null;

  // --- Lessons ---

  // --- Lessons: shared "apply" helpers ---
  // Each does the actual setLessons + persist work, reused by both the
  // live handler below AND any undo/redo entry that needs to replay the
  // same change — exactly so undo never has to re-derive this logic.

  function applyLessonTitle(lessonId: string, title: string) {
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, title } : l)));
    startTransition(() => {
      updateLesson(lessonId, { title }).catch(() => {});
    });
  }

  function applyLessonDescription(lessonId: string, description: string) {
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, description } : l)));
    startTransition(() => {
      updateLesson(lessonId, { description }).catch(() => {});
    });
  }

  function applyDeleteLesson(lessonId: string) {
    setLessons((prev) => prev.filter((l) => l.id !== lessonId));
    setSelection((sel) => (sel?.lessonId === lessonId ? null : sel));
    startTransition(() => {
      deleteLesson(lessonId).catch(() => {});
    });
  }

  function applyLessonOrder(orderList: { id: string; order: number }[]) {
    const orderById = new Map(orderList.map((o) => [o.id, o.order]));
    setLessons((prev) =>
      [...prev]
        .map((l) => (orderById.has(l.id) ? { ...l, order: orderById.get(l.id)! } : l))
        .sort((a, b) => a.order - b.order),
    );
    startTransition(() => {
      reorderLessons(orderList).catch(() => {});
    });
  }

  // Shared by handleAddLesson/handleImportLesson: undo deletes the
  // just-created lesson; redo re-runs whichever create call made it in the
  // first place. `recreate` always yields a BRAND NEW id (see
  // use-undo-redo.ts's module comment on why that's fine — redo is only
  // ever reachable immediately after this exact undo, before any other
  // action could have referenced the old one) — `idBox` tracks whichever
  // id is "live" right now so undo/redo round-trips any number of times
  // without going stale.
  function pushLessonCreateHistory(lesson: Lesson, recreate: () => Promise<Lesson>) {
    const idBox = { current: lesson.id };
    history.push({
      undo: () => {
        const id = idBox.current;
        setLessons((prev) => prev.filter((l) => l.id !== id));
        setSelection((sel) => (sel?.lessonId === id ? null : sel));
        startTransition(() => {
          deleteLesson(id).catch(() => {});
        });
      },
      redo: () => {
        startTransition(async () => {
          const recreated = await recreate();
          idBox.current = recreated.id;
          setLessons((prev) => [...prev, recreated]);
          setSelection({ type: "lesson", lessonId: recreated.id });
        });
      },
    });
  }

  // Full recreate-with-original-content for an undone delete — lessons'
  // `order` values are never renumbered when one is removed (deleteLesson
  // just filters), so every sibling's own order is already untouched; the
  // deleted lesson's own captured `order` is all that's needed to put it
  // straight back where it was, no sibling reorder call required. Loops
  // its slides back into existence the same way (createSlide + updateSlide
  // per slide, in their original order) since those were cascade-deleted
  // along with it.
  function pushDeleteLessonHistory(deletedLesson: Lesson) {
    const idBox = { current: deletedLesson.id };
    history.push({
      undo: () => {
        startTransition(async () => {
          const recreatedLesson = await createLesson(initialVersion.id, deletedLesson.order);
          idBox.current = recreatedLesson.id;
          const restoredLesson = await updateLesson(recreatedLesson.id, {
            title: deletedLesson.title,
            description: deletedLesson.description,
          });
          const restoredSlides: Slide[] = [];
          for (const originalSlide of [...deletedLesson.slides].sort((a, b) => a.order - b.order)) {
            const recreatedSlide = await createSlide(restoredLesson.id, originalSlide.slide_type, originalSlide.order);
            const restoredSlide = await updateSlide(recreatedSlide.id, {
              title: originalSlide.title,
              config: originalSlide.config,
            });
            slideConfigRef.current.set(restoredSlide.id, restoredSlide.config);
            restoredSlides.push(restoredSlide);
          }
          setLessons((prev) => [...prev, { ...restoredLesson, slides: restoredSlides }]);
          setSelection({ type: "lesson", lessonId: restoredLesson.id });
        });
      },
      redo: () => {
        const id = idBox.current;
        setLessons((prev) => prev.filter((l) => l.id !== id));
        setSelection((sel) => (sel?.lessonId === id ? null : sel));
        startTransition(() => {
          deleteLesson(id).catch(() => {});
        });
      },
    });
  }

  function handleAddLesson() {
    startTransition(async () => {
      const lesson = await createLesson(initialVersion.id, lessons.length);
      setLessons((prev) => [...prev, lesson]);
      setSelection({ type: "lesson", lessonId: lesson.id });
      pushLessonCreateHistory(lesson, () => createLesson(initialVersion.id, lessons.length));
    });
  }

  // Captures the field's value right as it gains focus — see
  // lessonTitleBaselineRef's own comment above.
  function handleLessonTitleFocus(lessonId: string) {
    const lesson = lessons.find((l) => l.id === lessonId);
    if (lesson) lessonTitleBaselineRef.current.set(lessonId, lesson.title);
  }

  function handleLessonTitleChange(lessonId: string, title: string) {
    applyLessonTitle(lessonId, title);
  }

  // Pushes ONE history entry for the whole focus-to-blur typing session —
  // not per keystroke, which would make Ctrl+Z only ever undo the very
  // last character typed. No-ops if the title never actually changed (e.g.
  // the field was just clicked into and back out of) or there's no
  // recorded baseline (shouldn't happen, but a focus that somehow never
  // fired shouldn't crash this).
  function handleLessonTitleBlur(lessonId: string) {
    const baseline = lessonTitleBaselineRef.current.get(lessonId);
    lessonTitleBaselineRef.current.delete(lessonId);
    const current = lessons.find((l) => l.id === lessonId)?.title;
    if (baseline === undefined || current === undefined || baseline === current) return;
    history.push({
      undo: () => applyLessonTitle(lessonId, baseline),
      redo: () => applyLessonTitle(lessonId, current),
    });
  }

  function handleLessonDescriptionChange(lessonId: string, description: string) {
    const oldDescription = lessons.find((l) => l.id === lessonId)?.description;
    applyLessonDescription(lessonId, description);
    if (oldDescription !== undefined && oldDescription !== description) {
      history.push({
        undo: () => applyLessonDescription(lessonId, oldDescription),
        redo: () => applyLessonDescription(lessonId, description),
      });
    }
  }

  function handleDeleteLesson(lessonId: string) {
    const lesson = lessons.find((l) => l.id === lessonId);
    applyDeleteLesson(lessonId);
    if (lesson) pushDeleteLessonHistory(lesson);
  }

  // Doesn't touch `lessons` state at all — saving a lesson as reusable
  // clones it into a separate library, it never changes the lesson itself.
  async function handleSaveLessonAsReusable(lessonId: string, name: string, description: string) {
    await saveLessonAsReusable(lessonId, name, description);
  }

  // Mirrors handleAddLesson's optimistic-append shape: the server does the
  // real cloning (services.import_reusable_lesson), this just appends
  // whatever Lesson it hands back.
  async function handleImportLesson(reusableLessonId: string) {
    const lesson = await importReusableLesson(initialVersion.id, reusableLessonId, lessons.length);
    setLessons((prev) => [...prev, lesson]);
    setSelection({ type: "lesson", lessonId: lesson.id });
    pushLessonCreateHistory(lesson, () => importReusableLesson(initialVersion.id, reusableLessonId, lessons.length));
  }

  function handleLessonDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Compute the reordered array up front and call setLessons/startTransition
    // as separate statements — calling startTransition from inside a setState
    // updater function is invalid (React: "Cannot call startTransition while
    // rendering"), since updater functions must be pure.
    const oldOrder = lessons.map((l) => ({ id: l.id, order: l.order }));
    const oldIndex = lessons.findIndex((l) => l.id === active.id);
    const newIndex = lessons.findIndex((l) => l.id === over.id);
    const reordered = arrayMove(lessons, oldIndex, newIndex).map((l, index) => ({ ...l, order: index }));
    const newOrder = reordered.map((l) => ({ id: l.id, order: l.order }));
    applyLessonOrder(newOrder);
    history.push({
      undo: () => applyLessonOrder(oldOrder),
      redo: () => applyLessonOrder(newOrder),
    });
  }

  // --- Slides: shared "apply" helpers (see the Lessons section above for
  // why these exist separately from the live handlers below) ---

  function applyDeleteSlide(lessonId: string, slideId: string) {
    setLessons((prev) =>
      prev.map((l) => (l.id === lessonId ? { ...l, slides: l.slides.filter((s) => s.id !== slideId) } : l)),
    );
    setSelection((sel) => (sel?.type === "slide" && sel.slideId === slideId ? null : sel));
    startTransition(() => {
      deleteSlide(slideId).catch(() => {});
    });
  }

  function applySlideOrder(lessonId: string, orderList: { id: string; order: number }[]) {
    const orderById = new Map(orderList.map((o) => [o.id, o.order]));
    setLessons((prev) =>
      prev.map((l) =>
        l.id === lessonId
          ? {
              ...l,
              slides: [...l.slides]
                .map((s) => (orderById.has(s.id) ? { ...s, order: orderById.get(s.id)! } : s))
                .sort((a, b) => a.order - b.order),
            }
          : l,
      ),
    );
    startTransition(() => {
      reorderSlides(orderList).catch(() => {});
    });
  }

  // Mirrors pushLessonCreateHistory exactly, one level down — see that
  // function's own comment.
  function pushSlideCreateHistory(lessonId: string, slide: Slide, recreate: () => Promise<Slide>) {
    const idBox = { current: slide.id };
    history.push({
      undo: () => {
        const id = idBox.current;
        setLessons((prev) =>
          prev.map((l) => (l.id === lessonId ? { ...l, slides: l.slides.filter((s) => s.id !== id) } : l)),
        );
        setSelection((sel) => (sel?.type === "slide" && sel.slideId === id ? null : sel));
        startTransition(() => {
          deleteSlide(id).catch(() => {});
        });
      },
      redo: () => {
        startTransition(async () => {
          const recreated = await recreate();
          idBox.current = recreated.id;
          setLessons((prev) =>
            prev.map((l) => (l.id === lessonId ? { ...l, slides: [...l.slides, recreated] } : l)),
          );
          setSelection({ type: "slide", lessonId, slideId: recreated.id });
        });
      },
    });
  }

  // Mirrors pushDeleteLessonHistory exactly, one level down — the deleted
  // slide's own captured `order` is enough to put it back in its original
  // position (siblings' own order values are untouched by a plain delete).
  function pushDeleteSlideHistory(lessonId: string, deletedSlide: Slide) {
    const idBox = { current: deletedSlide.id };
    history.push({
      undo: () => {
        startTransition(async () => {
          const recreated = await createSlide(lessonId, deletedSlide.slide_type, deletedSlide.order);
          idBox.current = recreated.id;
          const restored = await updateSlide(recreated.id, {
            title: deletedSlide.title,
            config: deletedSlide.config,
          });
          slideConfigRef.current.set(restored.id, restored.config);
          setLessons((prev) =>
            prev.map((l) => (l.id === lessonId ? { ...l, slides: [...l.slides, restored] } : l)),
          );
          setSelection({ type: "slide", lessonId, slideId: restored.id });
        });
      },
      redo: () => {
        const id = idBox.current;
        setLessons((prev) =>
          prev.map((l) => (l.id === lessonId ? { ...l, slides: l.slides.filter((s) => s.id !== id) } : l)),
        );
        setSelection((sel) => (sel?.type === "slide" && sel.slideId === id ? null : sel));
        startTransition(() => {
          deleteSlide(id).catch(() => {});
        });
      },
    });
  }

  function handleAddSlide(lessonId: string, slideType: SlideType) {
    startTransition(async () => {
      const lesson = lessons.find((l) => l.id === lessonId);
      const order = lesson ? lesson.slides.length : 0;
      const slide = await createSlide(lessonId, slideType, order);
      setLessons((prev) =>
        prev.map((l) => (l.id === lessonId ? { ...l, slides: [...l.slides, slide] } : l)),
      );
      setSelection({ type: "slide", lessonId, slideId: slide.id });
      pushSlideCreateHistory(lessonId, slide, () => {
        const latestLesson = lessons.find((l) => l.id === lessonId);
        return createSlide(lessonId, slideType, latestLesson ? latestLesson.slides.length : order);
      });
    });
  }

  // Mirrors handleAddSlide's optimistic-append shape, just cloning from a
  // saved SlideTemplate (see add-slide-menu.tsx's Templates submenu)
  // instead of creating a bare slide — the server does the real cloning
  // (services.import_slide_template), this just appends whatever Slide it
  // hands back.
  function handleImportSlideTemplate(lessonId: string, slideTemplateId: string) {
    startTransition(async () => {
      const lesson = lessons.find((l) => l.id === lessonId);
      const order = lesson ? lesson.slides.length : 0;
      const slide = await importSlideTemplate(lessonId, slideTemplateId, order);
      setLessons((prev) =>
        prev.map((l) => (l.id === lessonId ? { ...l, slides: [...l.slides, slide] } : l)),
      );
      setSelection({ type: "slide", lessonId, slideId: slide.id });
      pushSlideCreateHistory(lessonId, slide, () => {
        const latestLesson = lessons.find((l) => l.id === lessonId);
        return importSlideTemplate(lessonId, slideTemplateId, latestLesson ? latestLesson.slides.length : order);
      });
    });
  }

  // Doesn't touch `lessons` state at all — saving a slide as a template
  // clones it into a separate library, same as handleSaveLessonAsReusable
  // below never changing the lesson it was saved from. Prepends the new
  // entry to `slideTemplates` directly (not a full listSlideTemplates()
  // refetch) so it shows up in the Add slide menu immediately.
  async function handleSaveSlideAsTemplate(slideId: string, name: string) {
    const template = await saveSlideAsTemplate(slideId, name);
    setSlideTemplates((prev) => [template, ...prev]);
  }

  async function handleRenameSlideTemplate(slideTemplateId: string, name: string) {
    const template = await renameSlideTemplate(slideTemplateId, name);
    setSlideTemplates((prev) => prev.map((t) => (t.id === slideTemplateId ? template : t)));
  }

  // `reordered` already carries its own updated `order` values (computed
  // by the dialog's own arrayMove, same shape as handleSlideDragEnd/
  // handleLessonDragEnd below) — set local state immediately, then persist
  // in the background.
  function handleReorderSlideTemplates(reordered: SlideTemplate[]) {
    setSlideTemplates(reordered);
    startTransition(() => {
      reorderSlideTemplates(reordered.map((t) => ({ id: t.id, order: t.order }))).catch(() => {});
    });
  }

  // The warning/confirmation itself lives in manage-slide-templates-dialog.tsx
  // (ConfirmActionDialog) — this just does the actual delete once
  // confirmed, same split as every other handler here.
  async function handleDeleteSlideTemplate(slideTemplateId: string) {
    await deleteSlideTemplate(slideTemplateId);
    setSlideTemplates((prev) => prev.filter((t) => t.id !== slideTemplateId));
  }

  function applySlideFields(lessonId: string, slideId: string, data: Partial<Slide>) {
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

  // Only ever called with `{ title }` today (see RichTextTitle's own
  // onCommit, which already only fires on blur — one call per edit
  // session, not per keystroke, so pushing a history entry right here is
  // already the right granularity, unlike the lesson title Input above).
  function handleSlideChange(lessonId: string, slideId: string, data: Partial<Slide>) {
    const oldSlide = lessons.find((l) => l.id === lessonId)?.slides.find((s) => s.id === slideId);
    applySlideFields(lessonId, slideId, data);
    if (!oldSlide) return;
    const oldData: Partial<Slide> = {};
    for (const key of Object.keys(data) as (keyof Slide)[]) {
      (oldData as Record<string, unknown>)[key] = oldSlide[key];
    }
    history.push({
      undo: () => applySlideFields(lessonId, slideId, oldData),
      redo: () => applySlideFields(lessonId, slideId, data),
    });
  }

  // Config changes go through this dedicated path rather than
  // handleSlideChange, because config needs a MERGE (the backend's `config`
  // JSONField is replaced wholesale on save, not deep-merged, so every
  // PATCH must carry the slide's full config) and a merge needs the
  // CURRENT config to merge into. Reading that "current config" from a
  // render closure — `selectedSlide.config`, the way this used to work —
  // is a real bug, not a hypothetical one: two config changes fired close
  // together (e.g. typing body text, then pasting an image onto the same
  // slide moments later, both well inside typing debounce windows) both
  // read the SAME stale pre-either-change config, so whichever PATCH
  // effectively lands "second" wipes out the other's change — silent data
  // loss, reproduced while verifying the background-image feature (typed
  // body text, pasted an image, and the body text was gone after a
  // reload).
  //
  // The fix reads/writes slideConfigRef instead — a plain ref, not
  // `lessons` state — specifically because a setLessons functional updater
  // does NOT run synchronously when called (React defers invoking it to
  // when it flushes the update, which can be after this function has
  // already returned), so a second call arriving microseconds later can't
  // rely on "read inside the updater" to see the first call's result
  // either — and calling startTransition/updateSlide *inside* a setLessons
  // updater at all is its own bug (updater functions must stay pure; this
  // is the exact "Cannot call startTransition while rendering" class of
  // crash already fixed once before, for the drag-reorder handlers, and
  // reintroduced here on the first pass of this fix before being caught in
  // testing). A ref's read/write is genuinely synchronous with no
  // batching, so writing to it eagerly — before setLessons, before the
  // PATCH — is what actually guarantees the next call sees this call's
  // result, no matter how close together they happen. `lessons` (plain
  // state, safe to read here since this only ever runs in an event
  // handler, never during render) is the fallback for a slide's first-ever
  // edit, before the ref has anything recorded for it yet.
  // The actual apply step — used by the live handler below AND replayed
  // directly (no re-merge) by undo/redo, since both already have a
  // complete config to set rather than a partial to merge.
  function applyFullSlideConfig(lessonId: string, slideId: string, config: SlideConfig) {
    slideConfigRef.current.set(slideId, config);
    setLessons((prev) =>
      prev.map((l) =>
        l.id === lessonId
          ? { ...l, slides: l.slides.map((s) => (s.id === slideId ? { ...s, config } : s)) }
          : l,
      ),
    );
    startTransition(() => {
      updateSlide(slideId, { config }).catch(() => {});
    });
  }

  function handleSlideConfigChange(lessonId: string, slideId: string, partialConfig: Partial<SlideConfig>) {
    const fallbackConfig = lessons.find((l) => l.id === lessonId)?.slides.find((s) => s.id === slideId)?.config;
    const currentConfig = slideConfigRef.current.get(slideId) ?? fallbackConfig ?? {};
    const mergedConfig: SlideConfig = { ...currentConfig, ...partialConfig };
    applyFullSlideConfig(lessonId, slideId, mergedConfig);
    // See use-undo-redo.ts's beginBatch/endBatch — a group object-move
    // (group-drag-context.tsx) wraps several of these calls (one per
    // selected object) in a batch so they collapse into ONE undo step;
    // outside a batch, push() just appends this as its own step, same as
    // every other handler here.
    history.push({
      undo: () => applyFullSlideConfig(lessonId, slideId, currentConfig),
      redo: () => applyFullSlideConfig(lessonId, slideId, mergedConfig),
    });
  }

  // Mirrors pushDeleteLessonHistory/pushDeleteSlideHistory's shape.
  function handleDeleteSlide(lessonId: string, slideId: string) {
    const slide = lessons.find((l) => l.id === lessonId)?.slides.find((s) => s.id === slideId);
    applyDeleteSlide(lessonId, slideId);
    if (slide) pushDeleteSlideHistory(lessonId, slide);
  }

  function handleSlideDragEnd(lessonId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) return;
    // Same fix as handleLessonDragEnd: compute first, then setLessons and
    // startTransition as separate statements (not nested in the updater).
    const slides = [...lesson.slides].sort((a, b) => a.order - b.order);
    const oldOrder = slides.map((s) => ({ id: s.id, order: s.order }));
    const oldIndex = slides.findIndex((s) => s.id === active.id);
    const newIndex = slides.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(slides, oldIndex, newIndex).map((s, index) => ({ ...s, order: index }));
    const newOrder = reordered.map((s) => ({ id: s.id, order: s.order }));
    applySlideOrder(lessonId, newOrder);
    history.push({
      undo: () => applySlideOrder(lessonId, oldOrder),
      redo: () => applySlideOrder(lessonId, newOrder),
    });
  }

  // --- Publish ---

  function handlePublish() {
    setPublishing(true);
    setPublishError(null);
    startTransition(async () => {
      try {
        const result = await publishVersion(course.id, initialVersion.id);
        if (!result.ok) {
          setPublishError(result.error);
          return;
        }
        router.push(`/courses/${course.id}`);
      } finally {
        setPublishing(false);
      }
    });
  }

  // Object selection (a text box or image WITHIN the current slide) takes
  // priority over the slide's own view — the whole point of this feature is
  // that selecting something on the canvas replaces the normal per-slide
  // properties with that object's own controls. `selectedId` comes from
  // slide-selection-context.tsx and is completely independent of `selection`
  // above (course-builder's own lesson/slide picker state) — see
  // parseSelectedObject's own comment for why a selectedId left over from a
  // different slide can never incorrectly match here.
  const selectedObject = parseSelectedObject(selectedId, selectedSlide?.id);

  const panelProps: PropertiesPanelProps =
    selectedSlide && selectedLesson && selectedObject
      ? {
          kind: "object",
          slide: selectedSlide,
          object: selectedObject,
          courseVersionId: initialVersion.id,
          onConfigChange: (config) => handleSlideConfigChange(selectedLesson.id, selectedSlide.id, config),
        }
      : selectedSlide && selectedLesson
        ? {
            kind: "slide",
            slide: selectedSlide,
            courseVersionId: initialVersion.id,
            onConfigChange: (config) => handleSlideConfigChange(selectedLesson.id, selectedSlide.id, config),
            onTitleChange: (title) => handleSlideChange(selectedLesson.id, selectedSlide.id, { title }),
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

  const panelKey = selectedObject
    ? `object-${selectedId}`
    : selection
      ? selection.type === "lesson"
        ? `lesson-${selection.lessonId}`
        : `slide-${selection.slideId}`
      : "empty";

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link href={`/courses/${course.id}`} aria-label="Back to course" />}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{course.name}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">Draft</Badge>
              <span>Version {initialVersion.version_number}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button disabled={publishing} onClick={handlePublish}>
            {publishing ? "Publishing…" : "Publish"}
          </Button>
          {publishError && <p className="max-w-xs text-right text-xs text-destructive">{publishError}</p>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="w-60 shrink-0">
          <SlideRail
            lessons={lessons}
            slideTemplates={slideTemplates}
            selectedLessonId={selection?.type === "lesson" ? selection.lessonId : null}
            selectedSlideId={selection?.type === "slide" ? selection.slideId : null}
            onSelectLesson={(lessonId) => setSelection({ type: "lesson", lessonId })}
            onSelectSlide={(lessonId, slideId) => setSelection({ type: "slide", lessonId, slideId })}
            onLessonTitleChange={handleLessonTitleChange}
            onLessonTitleFocus={handleLessonTitleFocus}
            onLessonTitleBlur={handleLessonTitleBlur}
            onDeleteLesson={handleDeleteLesson}
            onDeleteSlide={handleDeleteSlide}
            onSlideDragEnd={handleSlideDragEnd}
            onLessonDragEnd={handleLessonDragEnd}
            onAddSlide={handleAddSlide}
            onImportSlideTemplate={handleImportSlideTemplate}
            onRenameSlideTemplate={handleRenameSlideTemplate}
            onReorderSlideTemplates={handleReorderSlideTemplates}
            onDeleteSlideTemplate={handleDeleteSlideTemplate}
            onAddLesson={handleAddLesson}
            onSaveLessonAsReusable={handleSaveLessonAsReusable}
            onImportLesson={handleImportLesson}
          />
        </div>

        {/* Wraps just the canvas (not the whole builder) — a group drag
            only ever moves objects on ONE slide at once, same scope as
            slide-selection-context's own selection. See
            group-drag-context.tsx's own comment on why it takes
            beginBatch/endBatch as plain props rather than importing
            use-undo-redo.ts's hook itself. */}
        <GroupDragProvider beginBatch={history.beginBatch} endBatch={history.endBatch}>
          <SlideCanvas
            slide={selectedSlide}
            courseVersionId={initialVersion.id}
            onTitleChange={(title) => {
              if (selectedLesson && selectedSlide) handleSlideChange(selectedLesson.id, selectedSlide.id, { title });
            }}
            onConfigChange={(config) => {
              if (selectedLesson && selectedSlide)
                handleSlideConfigChange(selectedLesson.id, selectedSlide.id, config);
            }}
            onSaveAsTemplate={(name) => {
              if (!selectedSlide) return Promise.resolve();
              return handleSaveSlideAsTemplate(selectedSlide.id, name);
            }}
          />
        </GroupDragProvider>

        {/* panelRef/panelInteractingRef (active-editor-context.tsx) point at
            THIS stable wrapper, not the PropertiesPanel instance inside it —
            switching between lesson/slide/object views remounts the panel
            (key={panelKey}) but never this div, so a text editor's onBlur
            guard (and slide-selection-context's own outside-click checks)
            can reliably tell "focus moved into the panel" regardless of
            which view is currently showing. */}
        {/* overflow-hidden (was overflow-y-auto) — SlideProperties
            (properties-panel.tsx) now needs to pin a few controls to its
            OWN bottom (layers/image dropbox/delete slide) rather than have
            them scroll away with everything else, which only works if
            THIS wrapper stops being the scroll container itself. Every
            other view rendered through PropertiesPanel (lesson/object/
            empty) now wraps its own content in `h-full overflow-y-auto`
            instead, so nothing lost its ability to scroll when it
            genuinely needs to — see PropertiesPanel's own comment. */}
        <div ref={panelRef} className="w-64 shrink-0 overflow-hidden rounded-lg border-2 border-border bg-card shadow-sm">
          <PropertiesPanel key={panelKey} {...panelProps} />
        </div>
      </div>
    </div>
  );
}
