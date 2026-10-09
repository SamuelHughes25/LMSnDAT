import { AdminCoursesView } from "@/components/admin-courses-view";
import { NewCourseDialog } from "@/components/new-course-dialog";
import type { Course } from "@/lib/course-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

export default async function CoursesPage() {
  const data = await djangoFetch<Paginated<Course>>("/courses/");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Courses</h1>
        <NewCourseDialog />
      </div>
      <div className="mt-4">
        <AdminCoursesView courses={data.results} />
      </div>
    </div>
  );
}
