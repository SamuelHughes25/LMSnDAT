"use server";

import { revalidatePath } from "next/cache";

import { DjangoApiError, djangoFetch, extractErrorDetail } from "@/lib/django";
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

// DELETE now archives rather than hard-deleting (see the backend's
// TemplateViewSet.destroy) — mirrors deleteCourse in actions/courses.ts
// exactly. The real, final hard delete — which deals with
// Assignment.template_version/Submission.template_version/Answer.question's
// on_delete=PROTECT — only lives behind purgeTemplate below now.
export async function deleteTemplate(templateId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<void>(`/templates/${templateId}/`, { method: "DELETE" });
    revalidatePath("/templates");
    return { ok: true };
  } catch (err) {
    const detail = extractErrorDetail(err, "This template can't be archived right now.");
    if (detail !== null) return { ok: false, error: detail };
    throw err;
  }
}

// --- Archive ---

export async function restoreTemplate(templateId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<Template>(`/templates/${templateId}/restore/`, { method: "POST" });
    revalidatePath("/archive");
    revalidatePath("/templates");
    return { ok: true };
  } catch (err) {
    const detail = extractErrorDetail(err, "This template can't be restored right now.");
    if (detail !== null) return { ok: false, error: detail };
    throw err;
  }
}

export async function purgeTemplate(templateId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<void>(`/templates/${templateId}/purge/`, { method: "POST" });
    revalidatePath("/archive");
    return { ok: true };
  } catch (err) {
    const detail = extractErrorDetail(err, "This template can't be permanently deleted.");
    if (detail !== null) return { ok: false, error: detail };
    throw err;
  }
}

// Shared by transferTemplateOwnership/setTemplateEditors below — both can
// come back as a 403 {"detail": "..."} (owner-or-admin-only, see the
// backend's IsContentOwnerOrAdmin) or a 400 field error, so this handles
// either shape rather than assuming one. Same "first string anywhere in
// the body" fallback as describeAssignmentError in actions/courses.ts.
function describeOwnershipError(err: DjangoApiError): string {
  try {
    const body: unknown = JSON.parse(err.message);
    if (body && typeof body === "object") {
      if ("detail" in body && typeof body.detail === "string") return body.detail;
      for (const value of Object.values(body)) {
        if (typeof value === "string") return value;
        if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      }
    }
  } catch {
    // Not JSON — fall through to the generic message below.
  }
  return `Something went wrong (status ${err.status}).`;
}

export async function transferTemplateOwnership(
  templateId: string,
  newOwnerId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<Template>(`/templates/${templateId}/transfer-ownership/`, {
      method: "POST",
      body: JSON.stringify({ owner: newOwnerId }),
    });
    revalidatePath(`/templates/${templateId}/members`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError && (err.status === 400 || err.status === 403)) {
      return { ok: false, error: describeOwnershipError(err) };
    }
    throw err;
  }
}

// Full replace, same convention as setCourseEditors in actions/courses.ts.
export async function setTemplateEditors(
  templateId: string,
  editorIds: number[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<Template>(`/templates/${templateId}/set-editors/`, {
      method: "POST",
      body: JSON.stringify({ editors: editorIds }),
    });
    revalidatePath(`/templates/${templateId}/members`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError && (err.status === 400 || err.status === 403)) {
      return { ok: false, error: describeOwnershipError(err) };
    }
    throw err;
  }
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
