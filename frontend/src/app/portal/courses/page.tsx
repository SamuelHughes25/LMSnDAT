import Link from "next/link";
import { BookOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Course, CourseVersion } from "@/lib/course-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// Every operative currently sees every course that exists — there's no
// assignment-by-job-role yet (that's a later phase). A course only becomes
// playable once it has a published version though: an in-progress draft
// isn't real content for an operative to see, so unpublished courses still
// show up (so nothing is silently hidden) but as a disabled, clearly-labeled
// card instead of a link.
export default async function PortalCoursesPage() {
  const [courses, versions] = await Promise.all([
    djangoFetch<Paginated<Course>>("/courses/"),
    djangoFetch<Paginated<CourseVersion>>("/course-versions/"),
  ]);

  const publishedCourseIds = new Set(
    versions.results.filter((v) => v.status === "published").map((v) => v.course),
  );

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Courses</h1>
        <p className="mt-1 text-muted-foreground">Pick a course to start.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.results.map((course) => {
          const isPlayable = publishedCourseIds.has(course.id);
          const card = (
            <Card className={isPlayable ? "h-full transition-colors hover:bg-muted/40" : "h-full opacity-60"}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{course.name}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-2 text-sm text-muted-foreground">{course.description || " "}</p>
                {!isPlayable && (
                  <Badge variant="outline" className="mt-2">
                    Not yet published
                  </Badge>
                )}
              </CardContent>
            </Card>
          );

          return isPlayable ? (
            <Link key={course.id} href={`/portal/courses/${course.id}`}>
              {card}
            </Link>
          ) : (
            <div key={course.id}>{card}</div>
          );
        })}
        {courses.results.length === 0 && (
          <p className="text-sm text-muted-foreground">No courses have been created yet.</p>
        )}
      </div>
    </div>
  );
}
