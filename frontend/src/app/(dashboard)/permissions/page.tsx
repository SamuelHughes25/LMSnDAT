import { redirect } from "next/navigation";

import { DeletePermissionSetButton } from "@/components/delete-permission-set-button";
import { NewPermissionSetDialog } from "@/components/new-permission-set-dialog";
import { PermissionSetTabCheckbox } from "@/components/permission-set-tab-checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PermissionSet } from "@/lib/accounts-types";
import { getCurrentUser } from "@/lib/dal";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

const TAB_COLUMNS: { field: keyof PermissionSet & `can_access_${string}`; label: string }[] = [
  { field: "can_access_templates", label: "Templates" },
  { field: "can_access_courses", label: "Courses" },
  { field: "can_access_users", label: "Users" },
  { field: "can_access_groups", label: "Groups" },
  { field: "can_access_permissions", label: "Permissions" },
  { field: "can_access_archive", label: "Archive" },
];

// Replaces the old fixed admin/manager roles — a permission set is a
// named bundle of dashboard tab access an admin builds themselves (see
// PermissionSet's own comment in accounts-types.ts), assigned to users
// from their own profile page. is_superuser/is_platform_admin accounts
// bypass this entirely and don't need one.
export default async function PermissionsPage() {
  const user = await getCurrentUser();
  if (!user.accessible_tabs.includes("permissions")) redirect("/dashboard");

  const permissionSets = await djangoFetch<Paginated<PermissionSet>>("/permission-sets/");

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Permissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build named bundles of dashboard access, then assign one to each user from their profile page.
            Checking a tab here gives full access to that section — view, create, edit, and archive.
          </p>
        </div>
        <NewPermissionSetDialog />
      </div>

      <div className="mt-4 rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {TAB_COLUMNS.map((col) => (
                <TableHead key={col.field} className="text-center">
                  {col.label}
                </TableHead>
              ))}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {permissionSets.results.map((permissionSet) => (
              <TableRow key={permissionSet.id}>
                <TableCell className="font-medium">{permissionSet.name}</TableCell>
                {TAB_COLUMNS.map((col) => (
                  <TableCell key={col.field} className="text-center">
                    <PermissionSetTabCheckbox
                      permissionSetId={permissionSet.id}
                      field={col.field}
                      checked={permissionSet[col.field]}
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <DeletePermissionSetButton permissionSetId={permissionSet.id} name={permissionSet.name} />
                </TableCell>
              </TableRow>
            ))}
            {permissionSets.results.length === 0 && (
              <TableRow>
                <TableCell colSpan={TAB_COLUMNS.length + 2} className="text-center text-muted-foreground">
                  No permission sets yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
