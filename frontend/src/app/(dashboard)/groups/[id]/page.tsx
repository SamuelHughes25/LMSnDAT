import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UsersSearchBar } from "@/components/users-search-bar";
import type { AccountUser, Group } from "@/lib/accounts-types";
import type { Course } from "@/lib/course-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Paginated, Template } from "@/lib/types";

// Read-only drill-down into one group — the courses/templates lists here
// are just for VIEWING what a group actually bundles; editing which
// courses/templates belong to it still happens from each course's/
// template's own "Roles" tab (see courses/[id]/(detail)/roles/page.tsx),
// and editing which users belong to it happens from each user's own detail
// page (see users/[id]/page.tsx) — this page just brings all three
// together in one place so an admin can see the whole bundle at a glance.
export default async function GroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q } = await searchParams;

  let group: Group;
  try {
    group = await djangoFetch<Group>(`/groups/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  // No dedicated "courses/templates in this group" endpoint — group.courses/
  // group.templates are just id arrays (see Group's own doc comment in
  // backend/apps/accounts/models.py), so resolving them to full records
  // means fetching the catalog and filtering client-side, same "fetch all,
  // filter by membership" approach the Dashboard's own overdue widget
  // already uses. Users, on the other hand, DO have a dedicated ?group=
  // filter (see UserViewSet.get_queryset()) — combined here with the same
  // ?search= param the standard Users page itself forwards (see
  // UsersSearchBar, reused as-is: it's already pathname-agnostic, so
  // rendering it on THIS page just works, writing its `q` param here
  // instead of on /users).
  const usersQuery = new URLSearchParams({ group: id, page_size: "200" });
  if (q) usersQuery.set("search", q);

  const [allCourses, allTemplates, allGroups, users] = await Promise.all([
    djangoFetch<Paginated<Course>>("/courses/?page_size=200"),
    djangoFetch<Paginated<Template>>("/templates/?page_size=200"),
    // Resolves each listed user's OWN full group badge set below — mirrors
    // the standard Users page exactly, so a user who belongs to this group
    // AND others still shows all of them, not just this one.
    djangoFetch<Paginated<Group>>("/groups/?page_size=200"),
    djangoFetch<Paginated<AccountUser>>(`/users/?${usersQuery.toString()}`),
  ]);

  const courses = allCourses.results.filter((c) => group.courses.includes(c.id));
  const templates = allTemplates.results.filter((t) => group.templates.includes(t.id));
  const groupById = new Map(allGroups.results.map((g) => [g.id, g]));

  return (
    <div className="space-y-6">
      <Link
        href="/groups"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to groups
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        {group.description && <p className="mt-1 text-muted-foreground">{group.description}</p>}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Courses</h2>
        <div className="rounded-lg border-2 border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="font-medium">
                    <Link href={`/courses/${course.id}`} className="hover:underline">
                      {course.name}
                    </Link>
                  </TableCell>
                  <TableCell>{new Date(course.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
              {courses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    No courses in this group yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Templates</h2>
        <div className="rounded-lg border-2 border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">
                    <Link href={`/templates/${template.id}`} className="hover:underline">
                      {template.name}
                    </Link>
                  </TableCell>
                  <TableCell>{new Date(template.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
              {templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    No templates in this group yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Users</h2>
          <UsersSearchBar />
        </div>
        <div className="rounded-lg border-2 border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Groups</TableHead>
                <TableHead>Permission</TableHead>
                <TableHead>Joined</TableHead>
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
                    <TableCell>{new Date(user.date_joined).toLocaleDateString()}</TableCell>
                  </TableRow>
                );
              })}
              {users.results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    {q ? "No users found." : "No users in this group yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
