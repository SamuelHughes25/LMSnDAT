import Link from "next/link";
import { notFound } from "next/navigation";

import { toggleCourseGroup } from "@/app/actions/courses";
import { AccessDenied } from "@/components/access-denied";
import { RoleAssignmentToggle } from "@/components/role-assignment-toggle";
import type { Group } from "@/lib/accounts-types";
import type { Course } from "@/lib/course-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import { hasTabAccess } from "@/lib/role-access";
import type { Paginated } from "@/lib/types";

// Lets an admin pick which group(s) this course belongs to — a group's own
// `courses` list is what determines whose curriculum it shows up in
// (alongside whatever templates that same group also bundles). Card/
// section styling matches the Members tab's visual conventions (max-w-2xl
// space-y-6), not its "not built yet" placeholder copy: this one is a
// real, working control.
export default async function CourseRolesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let course: Course;
  try {
    course = await djangoFetch<Course>(`/courses/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  // Hard gate, not just hiding the edit controls — this tab is full
  // capability or nothing, same "one on/off switch, no read-only tier"
  // design as every other course sub-permission (see course-detail-nav.tsx's
  // own matching Groups-link gate). Previously this page rendered
  // regardless, for anyone who could merely view the course at all.
  if (!course.viewer_can_edit_groups) {
    return <AccessDenied message="You don't have permission to manage this course's groups." />;
  }

  // Needs its own, SEPARATE permission check — can_edit_course_groups only
  // grants picking which EXISTING groups this course belongs to, not the
  // ability to create new ones (that's the global Groups tab). Reported
  // directly as a real gap: the "no groups yet" empty state below used to
  // link to /groups unconditionally, which a course editor without that
  // tab can't actually open — the backend now also refuses to even list
  // Groups for a portal member (GroupViewSet's own IsOfficeUser gate), but
  // an office user without the tab could still reach a page they can't use
  // without this.
  const canManageGroupsGlobally = await hasTabAccess("groups");

  const groups = await djangoFetch<Paginated<Group>>("/groups/");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Groups</div>
        <p className="mb-4 text-sm text-muted-foreground">
          Pick which groups this course is pushed out to. Anyone in one of these groups will see {course.name} in
          their curriculum.
        </p>
        <div className="space-y-2">
          {groups.results.map((group) => (
            // A plain arrow function closing over group.id/id here would
            // fail: Next.js can't pass an arbitrary closure from a Server
            // Component to a Client Component prop ("Event handlers cannot
            // be passed to Client Component props" — confirmed in a real
            // browser). .bind() on a Server Action IS specifically
            // supported for exactly this "parameterize before handing to a
            // client component" case.
            <RoleAssignmentToggle
              key={group.id}
              group={group}
              checked={course.group_ids.includes(group.id)}
              onToggle={toggleCourseGroup.bind(null, id, group.id, course.group_ids)}
              canEdit={course.viewer_can_edit_groups}
            />
          ))}
          {groups.results.length === 0 && (
            <p className="rounded-lg border-2 border-border bg-card p-4 text-center text-sm text-muted-foreground shadow-sm">
              {canManageGroupsGlobally ? (
                <>
                  No groups yet —{" "}
                  <Link href="/groups" className="text-primary hover:underline">
                    create one
                  </Link>{" "}
                  first.
                </>
              ) : (
                "No groups yet — ask someone with Groups access to create one."
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
