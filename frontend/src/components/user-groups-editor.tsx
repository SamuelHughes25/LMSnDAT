"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { addUserToGroup, removeUserFromGroup } from "@/app/actions/users";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type GroupOption = { id: string; name: string };

const PICK_VALUE = "__pick__";

// The user detail page's Groups section — badges for current membership,
// each removable, plus a select to add one more from whichever groups
// this user isn't already in. One group can grant both course and
// template access at once (see Group's own doc comment in
// backend/apps/accounts/models.py), so there's only ever one list here,
// not a course/template split.
export function UserGroupsEditor({
  userId,
  currentGroups,
  availableGroups,
}: {
  userId: number;
  currentGroups: GroupOption[];
  availableGroups: GroupOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const router = useRouter();

  const currentIds = new Set(currentGroups.map((g) => g.id));
  const addableGroups = availableGroups.filter((g) => !currentIds.has(g.id));

  function handleAdd(groupId: string) {
    startTransition(async () => {
      await addUserToGroup(userId, groupId);
      router.refresh();
    });
  }

  function handleRemove(groupId: string) {
    setPendingRemoveId(groupId);
    startTransition(async () => {
      await removeUserFromGroup(userId, groupId);
      setPendingRemoveId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {currentGroups.length === 0 && <span className="text-sm text-muted-foreground">No groups yet.</span>}
        {currentGroups.map((group) => (
          <Badge key={group.id} variant="secondary" className="gap-1 py-1 pr-1">
            {group.name}
            <button
              type="button"
              onClick={() => handleRemove(group.id)}
              disabled={pending && pendingRemoveId === group.id}
              aria-label={`Remove ${group.name}`}
              className="rounded-full p-0.5 hover:bg-muted-foreground/20"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      {/* Always renders SOME form of the add control — a Select with zero
          items still renders as an unusable, unlabeled empty trigger, so
          the two empty cases (no groups exist at all vs. this user is
          already in every one) each get their own explicit, visible
          message instead of the whole control just silently vanishing.
          Confirmed as a real gap: with only one group existing and a user
          already in it, the old `addableGroups.length > 0` guard hid this
          entire section, which reads identically to "the add feature isn't
          here" as a genuine missing feature would. */}
      {availableGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No groups exist yet —{" "}
          <Link href="/groups" className="text-primary hover:underline">
            create one
          </Link>{" "}
          first.
        </p>
      ) : addableGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Already in every group.</p>
      ) : (
        <Select value={PICK_VALUE} onValueChange={(v) => v && v !== PICK_VALUE && handleAdd(v)}>
          <SelectTrigger className="w-64" disabled={pending}>
            <SelectValue>
              {() => (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Plus className="h-3.5 w-3.5" /> Add to a group
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {addableGroups.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
