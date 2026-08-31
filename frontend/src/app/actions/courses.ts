"use server";

import { revalidatePath } from "next/cache";

import { djangoFetch } from "@/lib/django";
import type { Course, CourseVersion, Lesson, Slide, SlideConfig, SlideType } from "@/lib/course-types";

// --- Courses ---

export async function createCourse(name: string, description: string): Promise<Course> {
  const course = await djangoFetch<Course>("/courses/", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
  revalidatePath("/courses");
  return course;
}

export async function createDraft(courseId: string): Promise<CourseVersion> {
  const version = await djangoFetch<CourseVersion>(`/courses/${courseId}/create-draft/`, {
    method: "POST",
  });
  revalidatePath(`/courses/${courseId}`);
  return version;
}

export async function publishVersion(courseId: string, versionId: string): Promise<CourseVersion> {
  const version = await djangoFetch<CourseVersion>(`/course-versions/${versionId}/publish/`, {
    method: "POST",
  });
  revalidatePath(`/courses/${courseId}`);
  return version;
}

export async function deleteCourse(courseId: string): Promise<void> {
  await djangoFetch<void>(`/courses/${courseId}/`, { method: "DELETE" });
  revalidatePath("/courses");
}

// --- Lessons ---
// No revalidatePath below: the builder page keeps its own client-side state
// (needed for drag-and-drop) and syncs it directly from each action's
// return value rather than forcing a full Server Component refetch.

export async function createLesson(courseVersionId: string, order: number): Promise<Lesson> {
  return djangoFetch<Lesson>("/lessons/", {
    method: "POST",
    body: JSON.stringify({ course_version: courseVersionId, title: "New lesson", description: "", order }),
  });
}

export async function updateLesson(
  lessonId: string,
  data: Partial<Pick<Lesson, "title" | "description" | "order">>,
): Promise<Lesson> {
  return djangoFetch<Lesson>(`/lessons/${lessonId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteLesson(lessonId: string): Promise<void> {
  await djangoFetch<void>(`/lessons/${lessonId}/`, { method: "DELETE" });
}

export async function reorderLessons(lessons: { id: string; order: number }[]): Promise<void> {
  await Promise.all(
    lessons.map((l) =>
      djangoFetch(`/lessons/${l.id}/`, { method: "PATCH", body: JSON.stringify({ order: l.order }) }),
    ),
  );
}

// --- Slides ---

// Default config per slide_type on creation. Only "content" exists this
// stage — the switch is structured so later slide types (multiple_choice,
// categorize, ...) slot in as new cases without a rewrite.
function defaultSlideConfig(slideType: SlideType): SlideConfig {
  switch (slideType) {
    case "content":
    default:
      return { body: "", image_url: null, image_position: "top" };
  }
}

export async function createSlide(lessonId: string, slideType: SlideType, order: number): Promise<Slide> {
  return djangoFetch<Slide>("/slides/", {
    method: "POST",
    body: JSON.stringify({
      lesson: lessonId,
      slide_type: slideType,
      title: "New slide",
      order,
      config: defaultSlideConfig(slideType),
    }),
  });
}

export async function updateSlide(
  slideId: string,
  data: Partial<Pick<Slide, "title" | "order" | "config">>,
): Promise<Slide> {
  return djangoFetch<Slide>(`/slides/${slideId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteSlide(slideId: string): Promise<void> {
  await djangoFetch<void>(`/slides/${slideId}/`, { method: "DELETE" });
}

export async function reorderSlides(slides: { id: string; order: number }[]): Promise<void> {
  await Promise.all(
    slides.map((s) =>
      djangoFetch(`/slides/${s.id}/`, { method: "PATCH", body: JSON.stringify({ order: s.order }) }),
    ),
  );
}
