import { notFound } from "next/navigation";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CourseAccessCell } from "@/components/course-access-cell";
import { UsersSearchBar } from "@/components/users-search-bar";
import type { AccountUser, Group } from "@/lib/accounts-types";
import type { Course, CourseAssignment } from "@/lib/course-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// Looks and behaves like the main Users admin page (full searchable table
// of every user — see frontend/src/app/(dashboard)/users/page.tsx), not
// the old placeholder this replaced. Adds ONE new thing the main Users page
// doesn't have: a "Direct assignment" column, letting an admin/manager
// attach this course to a specific user directly, independent of Group
// membership (see courses/[id]/(detail)/roles/page.tsx, labeled "Groups" in
// the nav, for the existing group-based mechanism — that page is untouched,
// this one is a parallel, additive path).
//
// Deliberately does NOT cross-reference the Groups column against the
// Direct assignment column — a user showing BOTH a Groups badge for a
// group that already includes this course AND an "Assigned" badge here is
// expected, not a conflict to warn about: Groups routinely overlap on the
// same course (e.g. a company-wide safety course bundled into many
// different job-role groups), so treating that overlap as an error would
// misfire constantly. However many sources grant a user this course, the
// portal course list still shows it exactly once — see role-access.ts's
// Set-based union for why that's already guaranteed with no extra code.
export default async function CourseMembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q } = await searchParams;

  let course: Course;
  try {
    course = await djangoFetch<Course>(`/courses/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  const usersQuery = new URLSearchParams({ page_size: "200" });
  if (q) usersQuery.set("search", q);

  const [assignments, allGroups, users] = await Promise.all([
    djangoFetch<Paginated<CourseAssignment>>(`/course-assignments/?course=${id}&page_size=200`),
    // Resolves each listed user's own full group badge set — same
    // "always show everything, never filtered down" convention
    // groups/[id]/page.tsx already established.
    djangoFetch<Paginated<Group>>("/groups/?page_size=200"),
    djangoFetch<Paginated<AccountUser>>(`/users/?${usersQuery.toString()}`),
  ]);

  const assignmentByUserId = new Map(assignments.results.map((a) => [a.user, a.id]));
  const groupById = new Map(allGroups.results.map((g) => [g.id, g]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{course.name}</h1>
        <p className="mt-1 text-muted-foreground">
          Who can see and take this course — through a Group, directly assigned, or both.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <Link href={`/courses/${id}/roles`} className="text-sm text-muted-foreground hover:text-foreground">
          Manage group-based access on the Groups tab →
        </Link>
        <UsersSearchBar />
      </div>

      <div className="rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Groups</TableHead>
              <TableHead>Permission</TableHead>
              <TableHead>Direct assignment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.results.map((user) => {
              const userGroups = user.content_groups
                .map((groupId) => groupById.get(groupId))
                .filter((g): g is Group => !!g);
              return (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    <Link href={`/users/${user.id}`} className="hover:underline">
                      {user.username}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {userGroups.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {userGroups.map((userGroup) => (
                          <Badge key={userGroup.id} variant="secondary">
                            {userGroup.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <CourseAccessCell
                      courseId={id}
                      userId={user.id}
                      assignmentId={assignmentByUserId.get(user.id) ?? null}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
            {users.results.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  {q ? "No users found." : "No users yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
