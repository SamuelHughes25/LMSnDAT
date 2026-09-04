import { notFound } from "next/navigation";
import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { CurrentUser } from "@/lib/dal";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Template } from "@/lib/types";

// Mirrors courses/[id]/(detail)/members/page.tsx exactly. The backend
// already has a real Assignment model (apps.assignments) for assigning a
// template to teams/individuals, but — same as courses' member assignment —
// there's no frontend action/UI wired up for it yet, so this stays a stub
// naming what will live here rather than a functioning assignment picker.
export default async function TemplateMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let template: Template;
  try {
    template = await djangoFetch<Template>(`/templates/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  const owner = await djangoFetch<CurrentUser>(`/users/${template.created_by}/`);
  const ownerName = `${owner.first_name} ${owner.last_name}`.trim() || owner.username;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Owner</div>
        <div className="flex items-center justify-between rounded-lg border-2 border-border bg-card p-4 shadow-sm">
          <div>
            <div className="font-medium">{ownerName}</div>
            <div className="text-sm text-muted-foreground">{owner.username}</div>
          </div>
          <Badge variant="outline" className="capitalize">
            {owner.role}
          </Badge>
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Assignments</div>
        <div className="flex h-40 flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-6 text-center shadow-sm">
          <Users className="mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Assignment isn&apos;t built yet — this is where managers will assign this template to teams and
            individuals, on a schedule if needed.
          </p>
        </div>
      </div>
    </div>
  );
}
