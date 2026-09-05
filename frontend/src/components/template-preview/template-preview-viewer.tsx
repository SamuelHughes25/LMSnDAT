"use client";

import { useState } from "react";
import { Camera, CheckCircle2, MapPin, PenLine, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Question, Section } from "@/lib/types";
import { cn } from "@/lib/utils";

// A read-only-ish walkthrough of what an engineer sees when filling out this
// template, mirroring CoursePreviewViewer's role for courses. Answers live in
// local component state only — there's no frontend action for Submission/
// Answer yet (only the backend models exist, apps.submissions), so this is a
// layout/UX preview, not a functioning submission, same scope boundary as
// the Members tab's "assignment isn't built yet" stub.
//
// `mode` mirrors the editor/present/static convention used throughout the
// slide faces: "preview" (default) is the admin's own sanity-check view of
// the form's layout, no submit action. "fill" is the operative-facing
// experience — same rendering, plus a Submit button that ends in an honest
// completion screen (not a real submission yet; see the note above).
export function TemplatePreviewViewer({
  sections,
  mode = "preview",
}: {
  sections: Section[];
  mode?: "preview" | "fill";
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitted, setSubmitted] = useState(false);

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  const sortedSections = [...sections].sort((a, b) => a.order - b.order);

  if (submitted) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-lg border-2 border-border bg-card p-10 text-center shadow-sm">
        <CheckCircle2 className="h-10 w-10 text-primary" />
        <div className="text-lg font-medium">Audit complete</div>
        <p className="max-w-sm text-sm text-muted-foreground">
          Nice work. Submissions aren&apos;t synced anywhere yet — that&apos;s coming in a later phase — but
          everything here has been filled in.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12">
      {sortedSections.map((section) => (
        <div key={section.id} className="rounded-lg border-2 border-border bg-card shadow-sm">
          <div className="border-b border-border p-4">
            <div className="font-medium">{section.title}</div>
            {section.description && <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>}
          </div>
          <div className="space-y-5 p-4">
            {[...section.questions]
              .sort((a, b) => a.order - b.order)
              .map((question) => (
                <QuestionField
                  key={question.id}
                  question={question}
                  value={answers[question.id]}
                  onChange={(v) => setAnswer(question.id, v)}
                />
              ))}
            {section.questions.length === 0 && (
              <p className="text-sm text-muted-foreground">This section has no questions yet.</p>
            )}
          </div>
        </div>
      ))}

      {mode === "fill" && (
        <Button className="w-full" onClick={() => setSubmitted(true)}>
          Submit
        </Button>
      )}
    </div>
  );
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (question.question_type === "section_header") {
    return (
      <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">
        <div className="font-medium">{question.label}</div>
        {question.help_text && <p className="mt-0.5 text-sm text-muted-foreground">{question.help_text}</p>}
      </div>
    );
  }

  if (question.question_type === "instruction") {
    return (
      <div className="rounded-md bg-muted/60 p-3 text-sm">
        <div className="font-medium">{question.label}</div>
        {question.help_text && <p className="mt-0.5 text-muted-foreground">{question.help_text}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">
        {question.label || <span className="text-muted-foreground italic">Untitled question</span>}
        {question.is_required && <span className="ml-0.5 text-destructive">*</span>}
      </div>
      {question.help_text && <p className="text-sm text-muted-foreground">{question.help_text}</p>}
      <QuestionInput question={question} value={value} onChange={onChange} />
    </div>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (question.question_type) {
    case "text":
      return (
        <Textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-16"
          placeholder="Answer…"
        />
      );

    case "number":
      return (
        <Input
          type="number"
          value={typeof value === "string" || typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-40"
          placeholder="0"
        />
      );

    case "date":
      return (
        <Input
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-48"
        />
      );

    case "boolean":
      return (
        <div className="flex gap-2">
          <Button
            type="button"
            variant={value === true ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(true)}
          >
            Yes
          </Button>
          <Button
            type="button"
            variant={value === false ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(false)}
          >
            No
          </Button>
        </div>
      );

    case "single_select": {
      const options = question.config.options ?? [];
      return (
        // Base UI's Select.Value only shows the label of the selected item
        // for values whose Select.Item is still mounted (i.e. the popup is
        // open) unless the root is also given `items` up front — without it,
        // once the popup closes, Select.Value falls back to rendering the
        // raw value string. That was invisible for e.g. the font-size Select
        // (value and label are identical strings there), but option values
        // here carry a generated uniqueness suffix (see
        // select-options-editor.tsx's `option_${n}_${Date.now().toString(36)}`)
        // distinct from their label, so the raw value showed up as the
        // trigger text after picking an option — reported as "random chars
        // appended" to the label.
        <Select
          items={options}
          // `null`, not `undefined`: Base UI's Select treats a value of
          // `undefined` on the very first render as "uncontrolled", then
          // warns when a later render passes a real string (switching
          // controlled-ness mid-lifetime). `null` is a controlled "nothing
          // selected" from the start, matching the placeholder branch below.
          value={typeof value === "string" ? value : null}
          onValueChange={onChange}
        >
          <SelectTrigger className="w-full max-w-72">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case "multi_select": {
      const options = question.config.options ?? [];
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-1.5">
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(option.value)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...selected, option.value]
                      : selected.filter((v) => v !== option.value),
                  )
                }
              />
              {option.label}
            </label>
          ))}
          {options.length === 0 && <p className="text-sm text-muted-foreground">No options configured yet.</p>}
        </div>
      );
    }

    // Capture-type answers (photo/signature/gps/barcode) only make sense on
    // the device actually doing the audit — this preview shows the inert
    // placeholder an admin would expect to see there, not a working capture
    // widget, matching the scope boundary noted at the top of this file.
    case "photo":
      return <CapturePlaceholder icon={Camera} label="Photo evidence" />;
    case "signature":
      return <CapturePlaceholder icon={PenLine} label="Signature capture" />;
    case "gps":
      return <CapturePlaceholder icon={MapPin} label="Location captured automatically" />;
    case "barcode":
      return <CapturePlaceholder icon={ScanLine} label="Scan barcode / QR" />;

    default:
      return null;
  }
}

function CapturePlaceholder({ icon: Icon, label }: { icon: typeof Camera; label: string }) {
  return (
    <div
      className={cn(
        "flex h-20 w-full max-w-72 items-center justify-center gap-2 rounded-md border-2 border-dashed border-border text-sm text-muted-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </div>
  );
}
