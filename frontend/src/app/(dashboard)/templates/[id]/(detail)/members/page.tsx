import { notFound } from "next/navigation";
import { Users } from "lucide-react";

import { ContentOwnershipCard } from "@/components/content-ownership-card";
import type { AccountUser } from "@/lib/accounts-types";
import { getCurrentUser } from "@/lib/dal";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Paginated, Template } from "@/lib/types";

// The backend already has a real Assignment model (apps.assignments) for
// assigning a template to teams/individuals, but — same as before this
// page had an Ownership card — there's no frontend action/UI wired up for
// it yet, so the Assignments section below stays a stub naming what will
// live here rather than a functioning assignment picker.
export default async function TemplateMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let template: Template;
  try {
    template = await djangoFetch<Template>(`/templates/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  // Previously this page showed a read-only card built from
  // template.created_by, mislabeled "Owner" — created_by is just
  // permanent authorship history (and can be null, since a user who
  // created a template can be deleted — see Template.created_by's own
  // comment on the backend). `owner` is the real, transferable field that
  // belongs here now.
  const [allUsers, viewer] = await Promise.all([
    djangoFetch<Paginated<AccountUser>>("/users/?page_size=200"),
    // See ContentOwnershipCard's own comment — transfer-ownership is
    // is_superuser-only server-side now, so that control is only shown at
    // all to a viewer who could actually use it.
    getCurrentUser(),
  ]);
  const editors = template.editors.map((editorId, i) => ({ id: editorId, username: template.editor_usernames[i] }));
  // See courses/[id]/members/page.tsx's identical comment — the
  // super-super-user is excluded from every plain /users/ list, but has
  // to be a selectable target for transfer-ownership (including taking
  // ownership for themselves), since that action belongs to them alone.
  const ownershipCandidates =
    viewer.is_superuser && !allUsers.results.some((u) => u.id === viewer.id)
      ? [...allUsers.results, viewer]
      : allUsers.results;

  return (
    <div className="max-w-2xl space-y-6">
      <ContentOwnershipCard
        kind="template"
        contentId={id}
        owner={{ id: template.owner, username: template.owner_username }}
        originalOwnerUsername={template.created_by_username}
        editors={editors}
        candidateUsers={allUsers.results.map((u) => ({ id: u.id, username: u.username }))}
        ownershipCandidateUsers={ownershipCandidates.map((u) => ({ id: u.id, username: u.username }))}
        viewerIsSuperuser={viewer.is_superuser}
      />

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
