"use client";

import { useTransition } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import type { JobRole } from "@/lib/accounts-types";

// Shared by the course and template "Roles" tabs — the caller decides
// which of role.courses/role.templates to check membership against and
// which server action (toggleCourseRole/toggleTemplateRole) to call via
// onToggle, so this component itself doesn't need to know which kind of
// content it's assigning.
export function RoleAssignmentToggle({
  role,
  checked,
  onToggle,
}: {
  role: JobRole;
  checked: boolean;
  onToggle: (add: boolean) => Promise<unknown>;
}) {
  const [pending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    startTransition(async () => {
      await onToggle(next);
    });
  }

  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border-2 border-border bg-card p-3 shadow-sm">
      <div>
        <div className="font-medium">{role.name}</div>
        {role.description && <div className="text-sm text-muted-foreground">{role.description}</div>}
      </div>
      <Checkbox checked={checked} onCheckedChange={(c) => handleChange(c === true)} disabled={pending} />
    </label>
  );
}
