import { redirect } from "next/navigation";

import { ArchiveItemActions } from "@/components/archive-item-actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AccountUser } from "@/lib/accounts-types";
import type { Course } from "@/lib/course-types";
import { getCurrentUser } from "@/lib/dal";
import { djangoFetch } from "@/lib/django";
import type { Paginated, Template } from "@/lib/types";

function formatArchivedAt(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

// A low-frequency "restore from the trash" utility, deliberately kept
// separate from the Courses/Templates/Users pages themselves — see the
// sidebar's own comment in (dashboard)/layout.tsx. Lists every archived
// course/template/user together, since this is the one place an admin
// reviews "what's been archived and by whom" and either restores it or
// decides to permanently delete it for good.
export default async function ArchivePage() {
  const user = await getCurrentUser();
  // Archiving/restoring/purging all require the 'archive' tab on the
  // backend (see CourseViewSet/TemplateViewSet/UserViewSet's
  // HasArchiveTabAccess usage) — anyone without it would just get 403s
  // from every fetch below, so they're bounced before that rather than
  // shown a broken page.
  if (!user.accessible_tabs.includes("archive")) redirect("/");

  const [courses, templates, users] = await Promise.all([
    djangoFetch<Paginated<Course>>("/courses/?archived=true"),
    djangoFetch<Paginated<Template>>("/templates/?archived=true"),
    djangoFetch<Paginated<AccountUser>>("/users/?archived=true"),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Archive</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Courses, templates, and users archived from their trash buttons. Restore them back to normal,
          or permanently delete them for good.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-lg font-medium">Courses</h2>
        <div className="rounded-lg border-2 border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Archived by</TableHead>
                <TableHead>Archived at</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.results.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="font-medium">{course.name}</TableCell>
                  <TableCell>{course.archived_by_username ?? "—"}</TableCell>
                  <TableCell>{formatArchivedAt(course.archived_at)}</TableCell>
                  <TableCell>
                    <ArchiveItemActions
                      kind="course"
                      id={course.id}
                      itemName={course.name}
                      purgeWarning="All attempt history for every user who took this course will be removed too."
                    />
                  </TableCell>
                </TableRow>
              ))}
              {courses.results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No archived courses.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Templates</h2>
        <div className="rounded-lg border-2 border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Archived by</TableHead>
                <TableHead>Archived at</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.results.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>{template.archived_by_username ?? "—"}</TableCell>
                  <TableCell>{formatArchivedAt(template.archived_at)}</TableCell>
                  <TableCell>
                    <ArchiveItemActions
                      kind="template"
                      id={template.id}
                      itemName={template.name}
                      purgeWarning="All submission history for every user assigned this template will be removed too."
                    />
                  </TableCell>
                </TableRow>
              ))}
              {templates.results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No archived templates.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Users</h2>
        <div className="rounded-lg border-2 border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Archived by</TableHead>
                <TableHead>Archived at</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.results.map((archivedUser) => (
                <TableRow key={archivedUser.id}>
                  <TableCell className="font-medium">{archivedUser.username}</TableCell>
                  <TableCell>{archivedUser.archived_by_username ?? "—"}</TableCell>
                  <TableCell>{formatArchivedAt(archivedUser.archived_at)}</TableCell>
                  <TableCell>
                    <ArchiveItemActions
                      kind="user"
                      id={String(archivedUser.id)}
                      itemName={archivedUser.username}
                      purgeWarning=""
                    />
                  </TableCell>
                </TableRow>
              ))}
              {users.results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No archived users.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
