"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";

import { DeleteCourseButton } from "@/components/delete-course-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ViewToggle } from "@/components/view-toggle";
import type { Course } from "@/lib/course-types";
import { useViewMode } from "@/lib/use-view-mode";

const VIEW_STORAGE_KEY = "admin-courses-view";

// Same Compact/Normal split as the portal's own course list (see
// portal-courses-view.tsx and use-view-mode.ts for the shared toggle/
// storage plumbing), applied to the admin/manager side: "Compact" is the
// original dense data table (good for scanning many courses at once, e.g.
// by name or creation date), "Normal" is large single-column rows with the
// course's picture — the same picture course-thumbnail-settings.tsx lets an
// admin set, shown here for the first time on the admin's own side.
export function AdminCoursesView({ courses }: { courses: Course[] }) {
  const [view, setView] = useViewMode(VIEW_STORAGE_KEY);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ViewToggle view={view} onChange={setView} />
      </div>
      {view === "compact" ? <CompactTable courses={courses} /> : <NormalList courses={courses} />}
    </div>
  );
}

// The original table, unchanged — table-fixed + explicit widths (see this
// file's own history for why: an unbounded Description value used to force
// the whole table wider than the viewport, since a <TableCell> is
// whitespace-nowrap by default).
function CompactTable({ courses }: { courses: Course[] }) {
  return (
    <div className="rounded-lg border-2 border-border bg-card shadow-sm">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[20%]">Name</TableHead>
            <TableHead className="w-[38%]">Description</TableHead>
            <TableHead className="w-[14%]">Owner</TableHead>
            <TableHead className="w-[18%]">Created</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {courses.map((course) => (
            <TableRow key={course.id}>
              <TableCell className="truncate">
                <Link href={`/courses/${course.id}`} className="font-medium hover:underline">
                  {course.name}
                </Link>
              </TableCell>
              <TableCell className="truncate text-muted-foreground">{course.description || "—"}</TableCell>
              <TableCell className="truncate">
                <Link href={`/courses/${course.id}/members`} className="hover:underline">
                  {course.owner_username}
                </Link>
              </TableCell>
              <TableCell>{new Date(course.created_at).toLocaleDateString()}</TableCell>
              <TableCell>
                <DeleteCourseButton courseId={course.id} courseName={course.name} />
              </TableCell>
            </TableRow>
          ))}
          {courses.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No courses yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function NormalList({ courses }: { courses: Course[] }) {
  if (courses.length === 0) {
    return <p className="text-sm text-muted-foreground">No courses yet.</p>;
  }
  return (
    <div className="space-y-3">
      {courses.map((course) => (
        <div
          key={course.id}
          className="flex items-center gap-4 rounded-lg border-2 border-border bg-card p-4 shadow-sm"
        >
          <div className="h-20 w-32 shrink-0 overflow-hidden rounded-md bg-muted">
            {course.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- an admin-uploaded asset URL, not a static/known-domain import next/image can optimize.
              <img src={course.thumbnail} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <BookOpen className="h-8 w-8 text-muted-foreground/40" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <Link href={`/courses/${course.id}`} className="truncate text-lg font-semibold hover:underline">
              {course.name}
            </Link>
            <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{course.description || "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Owner{" "}
              <Link href={`/courses/${course.id}/members`} className="hover:underline">
                {course.owner_username}
              </Link>
              {" · "}
              Created {new Date(course.created_at).toLocaleDateString()}
            </p>
          </div>

          <DeleteCourseButton courseId={course.id} courseName={course.name} />
        </div>
      ))}
    </div>
  );
}
