import Link from "next/link";
import { notFound } from "next/navigation";

import { toggleTemplateInGroup } from "@/app/actions/groups";
import { RoleAssignmentToggle } from "@/components/role-assignment-toggle";
import type { Group } from "@/lib/accounts-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Paginated, Template } from "@/lib/types";

// Mirrors courses/[id]/(detail)/roles/page.tsx exactly, toggling a group's
// `templates` list instead of its `courses` list — the same group can (and
// often will) carry both, see Group's own doc comment in
// backend/apps/accounts/models.py.
export default async function TemplateRolesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let template: Template;
  try {
    template = await djangoFetch<Template>(`/templates/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  const groups = await djangoFetch<Paginated<Group>>("/groups/");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Groups</div>
        <p className="mb-4 text-sm text-muted-foreground">
          Pick which groups this template is pushed out to. Anyone in one of these groups will see{" "}
          {template.name} in their curriculum.
        </p>
        <div className="space-y-2">
          {groups.results.map((group) => (
            // See courses/[id]/(detail)/roles/page.tsx's identical comment
            // — .bind() on a Server Action, not a plain closure, is what
            // Next.js supports passing to a Client Component prop here.
            <RoleAssignmentToggle
              key={group.id}
              group={group}
              checked={group.templates.includes(id)}
              onToggle={toggleTemplateInGroup.bind(null, group.id, id)}
            />
          ))}
          {groups.results.length === 0 && (
            <p className="rounded-lg border-2 border-border bg-card p-4 text-center text-sm text-muted-foreground shadow-sm">
              No groups yet —{" "}
              <Link href="/groups" className="text-primary hover:underline">
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
