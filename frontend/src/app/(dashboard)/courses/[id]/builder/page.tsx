import { notFound } from "next/navigation";

import { CourseBuilder } from "@/components/course-builder/course-builder";
import type { Course, CourseVersion } from "@/lib/course-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

export default async function CourseBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let course: Course;
  try {
    course = await djangoFetch<Course>(`/courses/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  // page_size=200: the default (25 — see DefaultPagination) would silently
  // drop this course's OLDEST versions past the 25th once it's been
  // through enough create-draft/publish cycles, which for most courses
  // never matters since the draft being looked for below is always recent
  // — but it's cheap enough to just not have that ceiling at all, same
  // convention as every other "fetch everything for this one course" list
  // in this app.
  const versions = await djangoFetch<Paginated<CourseVersion>>(`/course-versions/?course=${id}&page_size=200`);
  const draft = versions.results.find((v) => v.status === "draft");

  if (!draft) {
    // No draft to edit — nothing for the builder to show. Send them back to
    // create one from the detail page rather than a bare 404.
    notFound();
  }

  return <CourseBuilder course={course} initialVersion={draft} />;
}
