"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListFilter } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
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
export const ACCOUNT_TYPES: { label: string; roles: string[] }[] = [
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

// One parent filter category, collapsed by default — its own little
// dropdown-within-the-dropdown. Clicking the row spawns its sub-filter
// checkboxes underneath it, rather than every category's options all
// being visible flatly at once the way this panel used to render them.
// A plain Collapsible, deliberately NOT a DropdownMenuItem — the rest of
// this panel's items are Base UI Menu items with their own "selecting one
// closes the whole Filters popup" behavior (fine for Clear filters, wrong
// here), so this category header needs to live outside that system
// entirely to just toggle open/closed in place instead.
export function FilterCategory({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <Collapsible className="px-1.5 py-1">
      <CollapsibleTrigger className="rounded-md py-0.5 hover:bg-accent hover:text-accent-foreground">
        <span className="flex items-center gap-1.5">
          {label}
          {count > 0 && (
            <Badge variant="secondary" className="px-1.5">
              {count}
            </Badge>
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel className="pt-1">
        <div className="space-y-0.5">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
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
  // NOT selectedRoles.size — "Office user" alone stores TWO role values
  // (admin + manager, see ACCOUNT_TYPES' own comment), so counting raw
  // stored values here double-counted a single checked box: checking just
  // "Office user" showed as 2 active filters, and checking it alongside
  // "Operative" showed 3 for what was genuinely only 2 checkboxes ticked.
  // Counting how many ACCOUNT_TYPES entries are actually fully satisfied
  // instead counts checkboxes, not underlying param values.
  const activeAccountTypeCount = ACCOUNT_TYPES.filter((type) => type.roles.every((r) => selectedRoles.has(r))).length;
  const activeCount = selectedGroups.size + selectedPermissionSets.size + activeAccountTypeCount;

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
        {/* "Account type" is entirely fixed (the Operative/Office-user
            split, see ACCOUNT_TYPES' own comment) — Group and Permissions
            below mix the same idea with values an admin actually creates
            over time, so a brand new group/permission set shows up here
            the moment it exists, with no code change. */}
        <FilterCategory label="Account type" count={activeAccountTypeCount}>
          {ACCOUNT_TYPES.map((type) => (
            <DropdownMenuCheckboxItem
              key={type.label}
              checked={type.roles.every((r) => selectedRoles.has(r))}
              onCheckedChange={() => apply((params) => toggleRoleGroup(params, type.roles))}
            >
              {type.label}
            </DropdownMenuCheckboxItem>
          ))}
        </FilterCategory>

        {groups.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <FilterCategory label="Group" count={selectedGroups.size}>
              {groups.map((group) => (
                <DropdownMenuCheckboxItem
                  key={group.id}
                  checked={selectedGroups.has(group.id)}
                  onCheckedChange={() => apply((params) => toggleValue(params, "group", group.id))}
                >
                  {group.name}
                </DropdownMenuCheckboxItem>
              ))}
            </FilterCategory>
          </>
        )}

        {permissionSets.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <FilterCategory label="Permissions" count={selectedPermissionSets.size}>
              {permissionSets.map((permissionSet) => (
                <DropdownMenuCheckboxItem
                  key={permissionSet.id}
                  checked={selectedPermissionSets.has(permissionSet.id)}
                  onCheckedChange={() => apply((params) => toggleValue(params, "permission_set", permissionSet.id))}
                >
                  {permissionSet.name}
                </DropdownMenuCheckboxItem>
              ))}
            </FilterCategory>
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
