"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { setCourseEditors, transferCourseOwnership } from "@/app/actions/courses";
import { setTemplateEditors, transferTemplateOwnership } from "@/app/actions/templates";
import { Badge } from "@/components/ui/badge";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type UserOption = { id: number; username: string };

const PICK_VALUE = "__pick__";

// One component for both entity types — only which pair of server actions
// to call differs, same "kind-based dispatch" shape as
// archive-item-actions.tsx uses for its own three entity kinds.
const ACTIONS = {
  course: { transferOwnership: transferCourseOwnership, setEditors: setCourseEditors },
  template: { transferOwnership: transferTemplateOwnership, setEditors: setTemplateEditors },
} as const;

// The course/template Members tab's Ownership card — who owns this
// content and who else can edit it (see apps.core.permissions
// .IsContentOwnerEditorOrAdmin on the backend) without needing the global
// admin role. Changing editors stays owner-or-admin-only server-side
// (IsContentOwnerOrAdmin) — anyone else who tries gets a clean error
// surfaced below rather than the control being hidden, same as before.
// Transferring OWNERSHIP is different now: deliberately tightened to the
// super-super-user ONLY (apps.core.permissions.IsSuperuser), not even the
// current owner — see that class's own comment on the backend for why.
// Since almost every viewer can never use it at all, the transfer Select
// itself is hidden entirely for anyone who isn't is_superuser (unlike the
// "attempt it and let the backend 403" convention everywhere else on this
// card), rather than showing a control only one account on the whole
// platform could ever click. Mirrors user-groups-editor.tsx's
// badges-plus-Select shape closely, just with a second "who's the one
// owner" control alongside the editors list.
export function ContentOwnershipCard({
  kind,
  contentId,
  owner,
  originalOwnerUsername,
  editors,
  candidateUsers,
  ownershipCandidateUsers,
  viewerIsSuperuser,
}: {
  kind: "course" | "template";
  contentId: string;
  owner: UserOption;
  // created_by_username — the permanent record of who originally owned
  // this, which transfer_ownership never touches (see Course.created_by's
  // own comment in course-types.ts). null if that account was later
  // permanently deleted, or — far more commonly — if `owner` has never
  // actually been transferred away from its original value, in which case
  // this is always identical to `owner.username` and isn't worth
  // showing twice (see the render below).
  originalOwnerUsername: string | null;
  editors: UserOption[];
  // Candidates for the Editors picker — the super-super-user is
  // deliberately never in this list (they're not meant to be an ordinary
  // content editor), unlike ownershipCandidateUsers below.
  candidateUsers: UserOption[];
  // Separate from candidateUsers above specifically so the
  // super-super-user CAN appear here even though they never appear as an
  // editor candidate — transfer-ownership is their own action to take
  // (including taking ownership for themselves), so they have to be a
  // selectable target for it, which a shared single list couldn't give
  // them without also making them pickable as an editor.
  ownershipCandidateUsers: UserOption[];
  viewerIsSuperuser: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The owner a transfer was just requested for — holding this (rather
  // than firing the transfer straight from the Select's onValueChange, the
  // old behavior) is what lets a confirm dialog sit in between: picking a
  // name no longer commits anything by itself, only opens the warning
  // below. null means the dialog is closed.
  const [pendingNewOwner, setPendingNewOwner] = useState<UserOption | null>(null);
  const router = useRouter();
  const { transferOwnership, setEditors } = ACTIONS[kind];

  const editorIds = new Set(editors.map((e) => e.id));
  const transferCandidates = ownershipCandidateUsers.filter((u) => u.id !== owner.id);
  const editorCandidates = candidateUsers.filter((u) => u.id !== owner.id && !editorIds.has(u.id));

  // The backend only takes a full-replace list (set-editors), not an
  // incremental add/remove — both handlers below compute the next
  // complete list client-side and send that, same "send the complete
  // list" convention as user-groups-editor.tsx's sibling toggleCourseInGroup
  // uses from the other direction.
  function handleAddEditor(newEditorId: string) {
    setError(null);
    const nextIds = [...editors.map((e) => e.id), Number(newEditorId)];
    startTransition(async () => {
      const result = await setEditors(contentId, nextIds);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleRemoveEditor(editorId: number) {
    setError(null);
    const nextIds = editors.filter((e) => e.id !== editorId).map((e) => e.id);
    startTransition(async () => {
      const result = await setEditors(contentId, nextIds);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 shadow-sm">
      <div className="text-lg font-medium">Ownership</div>
      <p className="mt-1 text-sm text-muted-foreground">
        The owner and editors can edit this {kind}&apos;s content without needing the Admin role. The owner (or
        an Admin) can change who edits — only the super-super-user can transfer ownership itself.
      </p>

      <div className="mt-4">
        <div className="text-xs text-muted-foreground">Owner</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{owner.username}</Badge>
          {viewerIsSuperuser && transferCandidates.length > 0 && (
            <Select
              value={PICK_VALUE}
              onValueChange={(v) => {
                if (!v || v === PICK_VALUE) return;
                const candidate = transferCandidates.find((u) => String(u.id) === v);
                if (candidate) setPendingNewOwner(candidate);
              }}
            >
              <SelectTrigger className="w-56" disabled={pending}>
                <SelectValue>{() => <span className="text-muted-foreground">Transfer ownership to…</span>}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {transferCandidates.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {/* Only shown once it actually differs from the current owner —
            i.e. this content has genuinely been transferred at least
            once. For the common case (never transferred), showing the
            same username twice added nothing. */}
        {originalOwnerUsername && originalOwnerUsername !== owner.username && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Originally created by <span className="font-medium">{originalOwnerUsername}</span>
          </p>
        )}
      </div>

      {pendingNewOwner && (
        <ConfirmActionDialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingNewOwner(null);
          }}
          title={`Transfer ownership to "${pendingNewOwner.username}"?`}
          description={
            <>
              This is permanent. <strong>{owner.username}</strong> will immediately lose owner-level edit rights
              to this {kind}, and — unlike the regular archive/delete actions elsewhere in this app — there is no
              self-service way to undo it or take it back: not {owner.username}, not an Admin, not even{" "}
              {pendingNewOwner.username} themselves if they later want to hand it off again. Only the
              super-super-user can transfer ownership of a {kind}, including reversing this specific change.
            </>
          }
          confirmLabel="Transfer ownership"
          pendingLabel="Transferring…"
          destructive
          action={() => transferOwnership(contentId, pendingNewOwner.id)}
          onSuccess={() => router.refresh()}
        />
      )}

      <div className="mt-4">
        <div className="text-xs text-muted-foreground">Editors</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {editors.length === 0 && <span className="text-sm text-muted-foreground">No editors yet.</span>}
          {editors.map((editor) => (
            <Badge key={editor.id} variant="secondary" className="gap-1 py-1 pr-1">
              {editor.username}
              <button
                type="button"
                onClick={() => handleRemoveEditor(editor.id)}
                disabled={pending}
                aria-label={`Remove ${editor.username} as editor`}
                className="rounded-full p-0.5 hover:bg-muted-foreground/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        {editorCandidates.length > 0 && (
          <Select value={PICK_VALUE} onValueChange={(v) => v && v !== PICK_VALUE && handleAddEditor(v)}>
            <SelectTrigger className="mt-2 w-56" disabled={pending}>
              <SelectValue>
                {() => (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Plus className="h-3.5 w-3.5" /> Add editor
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {editorCandidates.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
