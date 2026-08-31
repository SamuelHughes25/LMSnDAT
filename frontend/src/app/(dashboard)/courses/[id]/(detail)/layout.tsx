import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CourseDetailNav } from "@/components/course-detail-nav";
import type { Course } from "@/lib/course-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";

// Scoped to courses/[id]/(detail)/* via the route group — (detail) never
// appears in the URL, and courses/[id]/builder/ sits outside this group so
// the full-screen builder does NOT get this sub-nav on top of its own rail
// and the app's global sidebar.
export default async function CourseDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let course: Course;
  try {
    course = await djangoFetch<Course>(`/courses/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div>
      <Link
        href="/courses"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to courses
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{course.name}</h1>
        {course.description && <p className="mt-1 text-muted-foreground">{course.description}</p>}
      </div>

      <div className="flex items-start gap-6">
        <CourseDetailNav courseId={id} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
