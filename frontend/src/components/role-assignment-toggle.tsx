"use client";

import { useTransition } from "react";

import { Checkbox } from "@/components/ui/checkbox";

// Shared by the course and template "Roles" tabs — the caller decides
// which of group.courses/group.templates to check membership against and
// which server action (toggleCourseInGroup/toggleTemplateInGroup) to call
// via onToggle, so this component itself doesn't need to know which kind
// of content it's toggling. Typed structurally (not the full Group type)
// since all it ever reads is name/description.
export function RoleAssignmentToggle({
  group,
  checked,
  onToggle,
}: {
  group: { name: string; description: string };
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
        <div className="font-medium">{group.name}</div>
        {group.description && <div className="text-sm text-muted-foreground">{group.description}</div>}
      </div>
      <Checkbox checked={checked} onCheckedChange={(c) => handleChange(c === true)} disabled={pending} />
    </label>
  );
}
