import Link from "next/link";
import { notFound } from "next/navigation";

import { toggleTemplateRole } from "@/app/actions/roles";
import { RoleAssignmentToggle } from "@/components/role-assignment-toggle";
import type { JobRole } from "@/lib/accounts-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Paginated, Template } from "@/lib/types";

// Mirrors courses/[id]/(detail)/roles/page.tsx exactly, toggling a role's
// `templates` list instead of `courses` — included alongside the courses
// version because a role's whole point is to bundle "templates + courses"
// together (see JobRole's own doc comment), not just one of the two.
export default async function TemplateRolesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let template: Template;
  try {
    template = await djangoFetch<Template>(`/templates/${id}/`);
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
          Pick which roles this template is pushed out to. Anyone assigned one of these roles will see{" "}
          {template.name} in their curriculum.
        </p>
        <div className="space-y-2">
          {roles.results.map((role) => (
            // See courses/[id]/(detail)/roles/page.tsx's identical comment
            // — .bind() on a Server Action, not a plain closure, is what
            // Next.js supports passing to a Client Component prop here.
            <RoleAssignmentToggle
              key={role.id}
              role={role}
              checked={role.templates.includes(id)}
              onToggle={toggleTemplateRole.bind(null, role.id, id)}
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
