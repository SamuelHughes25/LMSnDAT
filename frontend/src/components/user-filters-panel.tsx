"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListFilter } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// "Account type" has no dedicated model of its own to list from (unlike
// Group/PermissionSet, which admins genuinely create over time) — it's the
// same Operative/Office-user split the Type column already renders (see
// accounts-types.ts's getUserKindLabel), just exposed as a filter too.
// "Office user" is every non-member role bundled together (admin AND
// manager — see toggleRoleGroup below), matching how the Type column
// already collapses both into one label.
const ACCOUNT_TYPES: { label: string; roles: string[] }[] = [
  { label: "Operative", roles: ["member"] },
  { label: "Office user", roles: ["admin", "manager"] },
];

// Toggles every value in `values` together, as one unit, against whatever
// the `role` param already holds — "Office user" has to add/remove BOTH
// admin and manager at once (it represents one checkbox, not two), and
// using a Set (rather than naive push/splice) means this is naturally
// idempotent regardless of which of the two happened to already be present.
function toggleRoleGroup(params: URLSearchParams, values: string[]) {
  const current = new Set(params.getAll("role"));
  const isActive = values.every((v) => current.has(v));
  for (const v of values) {
    if (isActive) current.delete(v);
    else current.add(v);
  }
  params.delete("role");
  for (const v of current) params.append("role", v);
}

// Toggles a single value within a repeated query param (?key=a&key=b) —
// OR semantics within the category: checking both Group A and Group B
// means "in A or B", not "in both".
function toggleValue(params: URLSearchParams, key: string, value: string) {
  const current = params.getAll(key);
  params.delete(key);
  if (current.includes(value)) {
    for (const v of current) if (v !== value) params.append(key, v);
  } else {
    for (const v of current) params.append(key, v);
    params.append(key, value);
  }
}

export function UserFiltersPanel({
  groups,
  permissionSets,
}: {
  groups: { id: string; name: string }[];
  permissionSets: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectedGroups = new Set(searchParams.getAll("group"));
  const selectedPermissionSets = new Set(searchParams.getAll("permission_set"));
  const selectedRoles = new Set(searchParams.getAll("role"));
  const activeCount = selectedGroups.size + selectedPermissionSets.size + selectedRoles.size;

  function apply(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams);
    mutate(params);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function clearAll() {
    apply((params) => {
      params.delete("group");
      params.delete("permission_set");
      params.delete("role");
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <ListFilter className="h-3.5 w-3.5" />
        Filters
        {activeCount > 0 && (
          <Badge variant="secondary" className="ml-1 px-1.5">
            {activeCount}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Account type</DropdownMenuLabel>
          {ACCOUNT_TYPES.map((type) => (
            <DropdownMenuCheckboxItem
              key={type.label}
              checked={type.roles.every((r) => selectedRoles.has(r))}
              onCheckedChange={() => apply((params) => toggleRoleGroup(params, type.roles))}
            >
              {type.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>

        {groups.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Group</DropdownMenuLabel>
              {groups.map((group) => (
                <DropdownMenuCheckboxItem
                  key={group.id}
                  checked={selectedGroups.has(group.id)}
                  onCheckedChange={() => apply((params) => toggleValue(params, "group", group.id))}
                >
                  {group.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}

        {permissionSets.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Permissions</DropdownMenuLabel>
              {permissionSets.map((permissionSet) => (
                <DropdownMenuCheckboxItem
                  key={permissionSet.id}
                  checked={selectedPermissionSets.has(permissionSet.id)}
                  onCheckedChange={() => apply((params) => toggleValue(params, "permission_set", permissionSet.id))}
                >
                  {permissionSet.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}

        {activeCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={clearAll}>Clear filters</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
