"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateUserJobRole } from "@/app/actions/users";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { JobRole } from "@/lib/accounts-types";

const NO_ROLE_VALUE = "__none__";

// Reassigning a user's role is the single most common edit on this table —
// an inline per-row select (auto-saves on change) rather than a separate
// edit dialog/page, since there's nothing else about a user worth editing
// here yet (permission level is set once at creation; email isn't wired up
// yet either — see accounts-types.ts).
export function InlineJobRoleSelect({
  userId,
  currentJobRoleId,
  roles,
}: {
  userId: number;
  currentJobRoleId: string | null;
  roles: JobRole[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleChange(value: string | null) {
    startTransition(async () => {
      await updateUserJobRole(userId, !value || value === NO_ROLE_VALUE ? null : value);
      router.refresh();
    });
  }

  return (
    <Select value={currentJobRoleId ?? NO_ROLE_VALUE} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger size="sm" className="w-40">
        {/* See job-role-filter-select.tsx's identical comment: SelectValue
            needs an explicit formatter or it renders the raw value (here,
            the role's UUID) instead of its name. */}
        <SelectValue>
          {(value: string) => (value === NO_ROLE_VALUE ? "None" : (roles.find((r) => r.id === value)?.name ?? "None"))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_ROLE_VALUE}>None</SelectItem>
        {roles.map((role) => (
          <SelectItem key={role.id} value={role.id}>
            {role.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
