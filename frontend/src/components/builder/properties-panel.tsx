"use client";

import type { Question, Section } from "@/lib/types";
import { QuestionProperties } from "./question-properties";
import { SectionProperties } from "./section-properties";

export type PropertiesPanelProps =
  | { kind: "empty" }
  | {
      kind: "section";
      section: Section;
      onDescriptionChange: (description: string) => void;
      onDelete: () => void;
    }
  | {
      kind: "question";
      question: Question;
      onChange: (data: Partial<Question>) => void;
      onDelete: () => void;
    };

export function PropertiesPanel(props: PropertiesPanelProps) {
  if (props.kind === "empty") {
    return (
      <div className="flex h-40 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a section or question to edit its properties.
      </div>
    );
  }

  if (props.kind === "section") {
    return (
      <SectionProperties
        section={props.section}
        onDescriptionChange={props.onDescriptionChange}
        onDelete={props.onDelete}
      />
    );
  }

  return <QuestionProperties question={props.question} onChange={props.onChange} onDelete={props.onDelete} />;
}
