"use server";

import { revalidatePath } from "next/cache";

import { djangoFetch } from "@/lib/django";
import { SELECT_QUESTION_TYPES } from "@/lib/types";
import type { Question, QuestionType, Section, Template, TemplateVersion } from "@/lib/types";

// --- Templates ---

export async function createTemplate(name: string, description: string): Promise<Template> {
  const template = await djangoFetch<Template>("/templates/", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
  revalidatePath("/templates");
  return template;
}

export async function createDraft(templateId: string): Promise<TemplateVersion> {
  const version = await djangoFetch<TemplateVersion>(`/templates/${templateId}/create-draft/`, {
    method: "POST",
  });
  revalidatePath(`/templates/${templateId}`);
  return version;
}

export async function publishVersion(templateId: string, versionId: string): Promise<TemplateVersion> {
  const version = await djangoFetch<TemplateVersion>(`/template-versions/${versionId}/publish/`, {
    method: "POST",
  });
  revalidatePath(`/templates/${templateId}`);
  return version;
}

// --- Sections ---
// No revalidatePath below: the builder page keeps its own client-side state
// (needed for drag-and-drop) and syncs it directly from each action's
// return value rather than forcing a full Server Component refetch.

export async function createSection(templateVersionId: string, order: number): Promise<Section> {
  return djangoFetch<Section>("/sections/", {
    method: "POST",
    body: JSON.stringify({ template_version: templateVersionId, title: "New section", order }),
  });
}

export async function updateSection(
  sectionId: string,
  data: Partial<Pick<Section, "title" | "description" | "order">>,
): Promise<Section> {
  return djangoFetch<Section>(`/sections/${sectionId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteSection(sectionId: string): Promise<void> {
  await djangoFetch<void>(`/sections/${sectionId}/`, { method: "DELETE" });
}

export async function reorderSections(sections: { id: string; order: number }[]): Promise<void> {
  await Promise.all(
    sections.map((s) =>
      djangoFetch(`/sections/${s.id}/`, { method: "PATCH", body: JSON.stringify({ order: s.order }) }),
    ),
  );
}

// --- Questions ---

export async function createQuestion(
  sectionId: string,
  questionType: QuestionType,
  order: number,
): Promise<Question> {
  const config = SELECT_QUESTION_TYPES.includes(questionType)
    ? { options: [{ value: "option_1", label: "Option 1" }] }
    : {};

  return djangoFetch<Question>("/questions/", {
    method: "POST",
    body: JSON.stringify({
      section: sectionId,
      question_type: questionType,
      label: "New question",
      order,
      is_required: false,
      config,
    }),
  });
}

export async function updateQuestion(
  questionId: string,
  data: Partial<
    Pick<Question, "label" | "help_text" | "order" | "is_required" | "config" | "display_logic" | "flag_rule">
  >,
): Promise<Question> {
  return djangoFetch<Question>(`/questions/${questionId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteQuestion(questionId: string): Promise<void> {
  await djangoFetch<void>(`/questions/${questionId}/`, { method: "DELETE" });
}

export async function reorderQuestions(questions: { id: string; order: number }[]): Promise<void> {
  await Promise.all(
    questions.map((q) =>
      djangoFetch(`/questions/${q.id}/`, { method: "PATCH", body: JSON.stringify({ order: q.order }) }),
    ),
  );
}
