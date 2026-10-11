"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { purgeCourse, restoreCourse } from "@/app/actions/courses";
import { purgeTemplate, restoreTemplate } from "@/app/actions/templates";
import { purgeUser, restoreUser, type PurgeUserResult } from "@/app/actions/users";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";

type ArchivedKind = "course" | "template" | "user";
type ActionResult = { ok: true } | { ok: false; error: string };
// Only purgeUser can ever come back with the richer owned-content shape —
// courses/templates purge with the plain {ok,error} result.
type PurgeResult = ActionResult | PurgeUserResult;

// One generic Restore/Permanently-delete pair for all three archivable
// entity types, rather than three near-identical components — the only
// thing that differs between them is which pair of server actions to
// call, so that's the one thing kept per-kind here.
const ACTIONS: Record<
  ArchivedKind,
  { restore: (id: string) => Promise<ActionResult>; purge: (id: string) => Promise<PurgeResult> }
> = {
  course: { restore: restoreCourse, purge: purgeCourse },
  template: { restore: restoreTemplate, purge: purgeTemplate },
  user: { restore: (id) => restoreUser(Number(id)), purge: (id) => purgeUser(Number(id)) },
};

function hasOwnedContent(result: PurgeResult): result is Extract<PurgeUserResult, { ok: false }> {
  return (
    !result.ok &&
    ("ownedCourses" in result || "ownedTemplates" in result) &&
    (!!result.ownedCourses?.length || !!result.ownedTemplates?.length)
  );
}

export function ArchiveItemActions({
  kind,
  id,
  itemName,
  purgeWarning,
}: {
  kind: ArchivedKind;
  id: string;
  itemName: string;
  // Entity-specific consequence of permanently deleting, shown in the
  // confirm dialog — e.g. "All attempt history for every user who took
  // this course will be removed too." Courses/templates have real
  // consequences here (purge cascade-deletes history); users don't, so
  // callers pass "".
  purgeWarning: string;
}) {
  const [restorePending, startRestoreTransition] = useTransition();
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const { restore, purge } = ACTIONS[kind];

  function handleRestore() {
    setRestoreError(null);
    startRestoreTransition(async () => {
      const result = await restore(id);
      if (!result.ok) {
        setRestoreError(result.error);
        return;
      }
      // No router.refresh() call needed — the archive page revalidates
      // its own path inside restoreCourse/restoreTemplate/restoreUser.
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={restorePending} onClick={handleRestore}>
          {restorePending ? "Restoring…" : "Restore"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPurgeOpen(true)}
          className="text-destructive hover:text-destructive"
        >
          Permanently delete
        </Button>
      </div>
      {restoreError && <span className="text-xs text-destructive">{restoreError}</span>}

      <ConfirmActionDialog<PurgeResult>
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title={`Permanently delete "${itemName}"?`}
        description={
          // A much stronger warning than the softened "Archive" one on the
          // trash buttons — this is the one genuinely irreversible action
          // left anywhere in this flow.
          purgeWarning ? `This cannot be undone. ${purgeWarning}` : "This cannot be undone."
        }
        confirmLabel="Permanently delete"
        pendingLabel="Deleting…"
        destructive
        action={() => purge(id)}
        renderError={(result) =>
          hasOwnedContent(result) ? (
            <div>
              <p>{result.error}</p>
              {!!result.ownedCourses?.length && (
                <>
                  <p className="mt-2 font-medium">Courses to reassign:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {result.ownedCourses.map((c) => (
                      <li key={c.id}>
                        <Link href={`/courses/${c.id}/members`} className="underline hover:no-underline">
                          {c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {!!result.ownedTemplates?.length && (
                <>
                  <p className="mt-2 font-medium">Templates to reassign:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {result.ownedTemplates.map((t) => (
                      <li key={t.id}>
                        <Link href={`/templates/${t.id}/members`} className="underline hover:no-underline">
                          {t.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            result.error
          )
        }
      />
    </div>
  );
}
