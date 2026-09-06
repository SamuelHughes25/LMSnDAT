"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { JobRole } from "@/lib/accounts-types";

const ALL_ROLES_VALUE = "__all__";

export function JobRoleFilterSelect({ roles }: { roles: JobRole[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("job_role") ?? ALL_ROLES_VALUE;

  function handleChange(value: string | null) {
    const params = new URLSearchParams(searchParams);
    if (!value || value === ALL_ROLES_VALUE) {
      params.delete("job_role");
    } else {
      params.set("job_role", value);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <Select value={current} onValueChange={handleChange}>
      <SelectTrigger className="w-48">
        {/* SelectValue's default (no children render-prop) shows the raw
            `value` string verbatim — confirmed in a real browser to render
            the literal "__all__" sentinel/a role's UUID instead of its
            name. A formatter function is base-ui's documented way to map
            the current value to a display label. */}
        <SelectValue>
          {(value: string) => (value === ALL_ROLES_VALUE ? "All roles" : (roles.find((r) => r.id === value)?.name ?? "All roles"))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_ROLES_VALUE}>All roles</SelectItem>
        {roles.map((role) => (
          <SelectItem key={role.id} value={role.id}>
            {role.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
