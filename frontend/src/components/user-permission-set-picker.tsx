"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setUserPermissionSet } from "@/app/actions/users";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE_VALUE = "__none__";

// A user's PermissionSet assignment — replaces the old fixed admin/manager
// distinction with a pick from whatever custom sets exist (see the new
// /permissions page). Meaningful for ANY account now, operative included —
// (dashboard)/layout.tsx no longer role-gates reaching a Manage route at
// all, only app-shell.tsx's own nav visibility does, which is driven by
// this same grant (see accessible_tabs) — the caller decides whether to
// render this at all.
export function UserPermissionSetPicker({
  userId,
  currentPermissionSetId,
  currentPermissionSetName,
  availablePermissionSets,
}: {
  userId: number;
  currentPermissionSetId: string | null;
  currentPermissionSetName: string | null;
  availablePermissionSets: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleChange(value: string | null) {
    setError(null);
    const nextId = !value || value === NONE_VALUE ? null : value;
    startTransition(async () => {
      const result = await setUserPermissionSet(userId, nextId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <Select value={currentPermissionSetId ?? NONE_VALUE} onValueChange={handleChange}>
        <SelectTrigger className="mt-1 w-56" disabled={pending}>
          <SelectValue>{() => currentPermissionSetName ?? "No access"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>No access</SelectItem>
          {availablePermissionSets.map((permissionSet) => (
            <SelectItem key={permissionSet.id} value={permissionSet.id}>
              {permissionSet.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
