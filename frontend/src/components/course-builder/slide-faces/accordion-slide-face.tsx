"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AccordionSection, Slide } from "@/lib/course-types";
import { cn } from "@/lib/utils";
import { StaticField } from "./content-slide-face";
import type { SlideFaceProps } from "./index";
import { WIDGET_INPUT_CHROME, WidgetEditableText } from "./widget-text-field";

// The spec's min-1/max-8 are UI guidance (min) and a hard cap (max) — same
// split as match_pairs' MIN_PAIRS/MAX_PAIRS. Only the max is enforced by
// the backend (SlideSerializer.validate()'s accordion branch); a min-1
// slide is a completely valid, if uninteresting, save.
const MIN_SECTIONS = 1;
const MAX_SECTIONS = 8;

function makeSectionId(n: number) {
  return `section_${n}_${Date.now().toString(36)}`;
}

export function AccordionSlideFace({ slide, mode, onConfigChange, onInteraction }: SlideFaceProps) {
  const sections = slide.config.sections ?? [];

  if (mode === "edit") {
    return <AccordionEditor slide={slide} sections={sections} onConfigChange={onConfigChange} />;
  }

  if (mode === "present") {
    return <AccordionPresent slide={slide} sections={sections} onInteraction={onInteraction} />;
  }

  return <AccordionStatic sections={sections} />;
}

// On-canvas direct-manipulation editor — same list-editing pattern as
// match-pairs-slide-face.tsx's pairs list, applied to title/body sections.
// Local state still mirrors the incoming `sections` array's STRUCTURE (this
// component is remounted via key={slide.id} in slide-canvas.tsx whenever
// the selected slide changes, so there's no stale-state risk) — each
// section's own title/body TEXT is now owned by its own WidgetEditableText
// instance instead (widget-text-field.tsx; same rich-text capability every
// other text field in this app has, requested directly: "edit everything I
// normally would apart from size").
function AccordionEditor({
  slide,
  sections,
  onConfigChange,
}: {
  slide: Slide;
  sections: AccordionSection[];
  onConfigChange: SlideFaceProps["onConfigChange"];
}) {
  const [localSections, setLocalSections] = useState(sections);

  function handleFieldCommit(index: number, field: "title" | "body", html: string) {
    const next = localSections.map((s, i) => (i === index ? { ...s, [field]: html } : s));
    setLocalSections(next);
    onConfigChange?.({ sections: next });
  }

  // Discrete actions (add, remove, reorder) commit immediately — no
  // debounce, since each is a single deliberate click rather than a stream
  // of keystrokes.
  function commitSections(next: AccordionSection[]) {
    setLocalSections(next);
    onConfigChange?.({ sections: next });
  }

  function addSection() {
    if (localSections.length >= MAX_SECTIONS) return;
    const n = localSections.length + 1;
    commitSections([...localSections, { id: makeSectionId(n), title: "", body: "" }]);
  }

  function removeSection(index: number) {
    if (localSections.length <= MIN_SECTIONS) return;
    commitSections(localSections.filter((_, i) => i !== index));
  }

  // Up/down swap-and-commit — deliberately not a full dnd-kit drag list:
  // reordering accordion sections is an occasional editing action, not
  // itself the point of the interaction (unlike sequencing, where drag
  // reordering *is* the authored answer key), so a two-button swap is
  // enough and keeps this editor free of extra drag machinery.
  function moveSection(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= localSections.length) return;
    const next = [...localSections];
    [next[index], next[target]] = [next[target], next[index]];
    commitSections(next);
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 px-16 py-12 text-foreground">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {localSections.map((section, index) => (
          <div key={section.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <div className={cn(WIDGET_INPUT_CHROME, "flex-1")}>
                <WidgetEditableText
                  fieldId={`${slide.id}:section:${section.id}:title`}
                  value={section.title}
                  placeholder="Section title"
                  className="font-medium"
                  onCommit={(html) => handleFieldCommit(index, "title", html)}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={index === 0}
                onClick={() => moveSection(index, -1)}
                aria-label="Move section up"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={index === localSections.length - 1}
                onClick={() => moveSection(index, 1)}
                aria-label="Move section down"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={localSections.length <= MIN_SECTIONS}
                onClick={() => removeSection(index)}
                aria-label="Remove section"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className={cn(WIDGET_INPUT_CHROME, "min-h-16 text-sm")}>
              <WidgetEditableText
                fieldId={`${slide.id}:section:${section.id}:body`}
                value={section.body}
                placeholder="Hidden content shown when this section is expanded"
                onCommit={(html) => handleFieldCommit(index, "body", html)}
              />
            </div>
          </div>
        ))}
      </div>

      {localSections.length < MAX_SECTIONS && (
        <Button variant="outline" size="sm" onClick={addSection} className="self-start">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add section
        </Button>
      )}
    </div>
  );
}

// Genuinely interactive learner-facing render. No "correct answer" here —
// this is self-paced reveal content, not an assessment — so `onInteraction`
// reports completion (every section opened at least once), not
// correctness. See slide-interaction.ts's doc comment.
function AccordionPresent({
  slide,
  sections,
  onInteraction,
}: {
  slide: Slide;
  sections: AccordionSection[];
  onInteraction: SlideFaceProps["onInteraction"];
}) {
  // openIds: which sections are CURRENTLY expanded (toggles both ways,
  // multiple simultaneously open allowed — a forced single-open accordion
  // wasn't asked for and would need extra exclusive-state bookkeeping for
  // no requested benefit). everOpenedIds: a monotonic superset used only to
  // detect "has the learner seen everything" — never shrinks, even when a
  // section is later collapsed again.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [everOpenedIds, setEverOpenedIds] = useState<Set<string>>(new Set());
  const [reported, setReported] = useState(false);

  // Reads everOpenedIds directly from the closure and calls setEverOpenedIds
  // with a plain computed value, rather than a functional updater — same
  // shape as match-pairs-slide-face.tsx's handleDefinitionClick. A setState
  // updater function is not guaranteed to run only once, synchronously,
  // inside the event handler that scheduled it; React can (and, confirmed
  // in a real browser here, does) invoke it again during a later render
  // pass, which made the ORIGINAL version of this function's onInteraction
  // call — nested inside setEverOpenedIds' updater — fire while
  // AccordionPresent was rendering, throwing "Cannot update a component
  // (CoursePreviewViewer) while rendering a different component
  // (AccordionPresent)". Calling onInteraction directly in this handler,
  // after a plain (non-updater) setState, avoids the updater entirely.
  function toggleSection(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

    if (!everOpenedIds.has(id)) {
      const next = new Set(everOpenedIds).add(id);
      setEverOpenedIds(next);
      if (next.size === sections.length && !reported) {
        setReported(true);
        onInteraction?.({
          slideId: slide.id,
          slideType: slide.slide_type,
          isCorrect: true,
          score: 1,
          answeredAt: new Date().toISOString(),
          detail: { sectionsOpened: Array.from(next) },
        });
      }
    }
  }

  if (sections.length === 0) {
    return <div className="flex h-full w-full flex-col px-16 py-12 text-foreground" />;
  }

  return (
    <div className="flex h-full w-full flex-col justify-center gap-2 overflow-y-auto px-16 py-12 text-foreground">
      {sections.map((section) => {
        const isOpen = openIds.has(section.id);
        return (
          <div key={section.id} className="overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-lg font-medium hover:bg-muted"
            >
              <StaticField value={section.title} placeholder="—" className="flex-1" />
              <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
              <div className="border-t border-border px-4 py-3 text-base text-foreground">
                <StaticField value={section.body} placeholder="—" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Thumbnail render — every header collapsed and inert, chevrons shown but
// non-interactive. Matches this project's "true miniature, not an
// editorial view" thumbnail philosophy already established for the other
// slide types.
function AccordionStatic({ sections }: { sections: AccordionSection[] }) {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-2 px-16 py-12 text-foreground">
      {sections.length === 0 ? (
        <span className="text-lg text-muted-foreground/50">Click to add sections</span>
      ) : (
        sections.map((section) => (
          <div
            key={section.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border px-4 py-3 text-lg font-medium"
          >
            <StaticField value={section.title} placeholder="—" className="flex-1" />
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
          </div>
        ))
      )}
    </div>
  );
}
