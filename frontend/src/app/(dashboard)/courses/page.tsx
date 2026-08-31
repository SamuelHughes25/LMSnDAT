import Link from "next/link";

import { DeleteCourseButton } from "@/components/delete-course-button";
import { NewCourseDialog } from "@/components/new-course-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      <div className="mt-4 rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.results.map((course) => (
              <TableRow key={course.id}>
                <TableCell>
                  <Link href={`/courses/${course.id}`} className="font-medium hover:underline">
                    {course.name}
                  </Link>
                </TableCell>
                <TableCell>{course.description || "—"}</TableCell>
                <TableCell>{new Date(course.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <DeleteCourseButton courseId={course.id} courseName={course.name} />
                </TableCell>
              </TableRow>
            ))}
            {data.results.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No courses yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
