"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AccordionSection, Slide } from "@/lib/course-types";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { cn } from "@/lib/utils";
import type { SlideFaceProps } from "./index";

// Same debounce budget as the other slide-face editors — governs how often
// a network PATCH fires while typing into a title/body field, not how the
// field itself feels (local echo state updates on every keystroke).
// Discrete actions (add/remove/reorder section) commit immediately.
const CHANGE_DEBOUNCE_MS = 500;

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
    return <AccordionEditor sections={sections} onConfigChange={onConfigChange} />;
  }

  if (mode === "present") {
    return <AccordionPresent slide={slide} sections={sections} onInteraction={onInteraction} />;
  }

  return <AccordionStatic sections={sections} />;
}

// On-canvas direct-manipulation editor — same list-editing pattern as
// match-pairs-slide-face.tsx's pairs list, applied to title/body sections.
// Local state mirrors the incoming config (this component is remounted via
// key={slide.id} in slide-canvas.tsx whenever the selected slide changes,
// so there's no stale-state risk).
//
// `body` is a plain <textarea>, not TipTap rich text — content-slide-face.tsx's
// RichTextBody is tightly coupled to SlideTextToolbar's focus-follows-
// selection wiring and to PositionableBox, not reusable per-row as-is, and
// every other structured-list field in this app (multiple_choice options,
// match_pairs keyword/definition, table cells) is deliberately plain for
// the same "avoid a grid of TipTap instances" reason. A real trade-off for
// long content, not an oversight — see AccordionSection's own comment in
// course-types.ts.
function AccordionEditor({
  sections,
  onConfigChange,
}: {
  sections: AccordionSection[];
  onConfigChange: SlideFaceProps["onConfigChange"];
}) {
  const [localSections, setLocalSections] = useState(sections);

  const debouncedCommitSections = useDebouncedCallback(
    (next: AccordionSection[]) => onConfigChange?.({ sections: next }),
    CHANGE_DEBOUNCE_MS,
  );

  function handleFieldChange(index: number, field: "title" | "body", value: string) {
    const next = localSections.map((s, i) => (i === index ? { ...s, [field]: value } : s));
    setLocalSections(next);
    debouncedCommitSections(next);
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
              <Input
                value={section.title}
                onChange={(e) => handleFieldChange(index, "title", e.target.value)}
                placeholder="Section title"
                className="flex-1 font-medium"
              />
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
            <textarea
              value={section.body}
              onChange={(e) => handleFieldChange(index, "body", e.target.value)}
              placeholder="Hidden content shown when this section is expanded"
              rows={3}
              className="w-full resize-y rounded border border-border bg-transparent p-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary/40"
            />
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
    <div className="flex h-full w-full flex-col gap-2 overflow-y-auto px-16 py-12 text-foreground">
      {sections.map((section) => {
        const isOpen = openIds.has(section.id);
        return (
          <div key={section.id} className="overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-lg font-medium hover:bg-muted"
            >
              {section.title || "—"}
              <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
              <div className="border-t border-border px-4 py-3 text-base whitespace-pre-wrap text-foreground">
                {section.body || "—"}
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
    <div className="flex h-full w-full flex-col gap-2 px-16 py-12 text-foreground">
      {sections.length === 0 ? (
        <span className="text-lg text-muted-foreground/50">Click to add sections</span>
      ) : (
        sections.map((section) => (
          <div
            key={section.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border px-4 py-3 text-lg font-medium"
          >
            {section.title || "—"}
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
          </div>
        ))
      )}
    </div>
  );
}
