import Link from "next/link";
import { notFound } from "next/navigation";

import { toggleCourseRole } from "@/app/actions/roles";
import { RoleAssignmentToggle } from "@/components/role-assignment-toggle";
import type { JobRole } from "@/lib/accounts-types";
import type { Course } from "@/lib/course-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// Lets an admin pick which role group(s) this course belongs to — the
// role's own `courses` list is what determines whose curriculum it shows
// up in. Card/section styling matches the Members tab's visual
// conventions (max-w-2xl space-y-6), not its "not built yet" placeholder
// copy: this one is a real, working control.
export default async function CourseRolesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let course: Course;
  try {
    course = await djangoFetch<Course>(`/courses/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  const roles = await djangoFetch<Paginated<JobRole>>("/job-roles/");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Roles</div>
        <p className="mb-4 text-sm text-muted-foreground">
          Pick which roles this course is pushed out to. Anyone assigned one of these roles will see{" "}
          {course.name} in their curriculum.
        </p>
        <div className="space-y-2">
          {roles.results.map((role) => (
            // A plain arrow function closing over role.id/id here would
            // fail: Next.js can't pass an arbitrary closure from a Server
            // Component to a Client Component prop ("Event handlers cannot
            // be passed to Client Component props" — confirmed in a real
            // browser). .bind() on a Server Action IS specifically
            // supported for exactly this "parameterize before handing to a
            // client component" case.
            <RoleAssignmentToggle
              key={role.id}
              role={role}
              checked={role.courses.includes(id)}
              onToggle={toggleCourseRole.bind(null, role.id, id)}
            />
          ))}
          {roles.results.length === 0 && (
            <p className="rounded-lg border-2 border-border bg-card p-4 text-center text-sm text-muted-foreground shadow-sm">
              No roles yet —{" "}
              <Link href="/roles" className="text-primary hover:underline">
                create one
              </Link>{" "}
              first.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
