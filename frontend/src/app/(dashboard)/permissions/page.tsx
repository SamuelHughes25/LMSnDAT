import { redirect } from "next/navigation";
import { Check, X } from "lucide-react";

import { DeletePermissionSetButton } from "@/components/delete-permission-set-button";
import { PermissionSetFormDialog } from "@/components/permission-set-form-dialog";
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
import { PERMISSION_SET_SECTIONS } from "@/lib/permission-set-sections";
import type { Paginated } from "@/lib/types";

// Replaces the old fixed admin/manager roles — a permission set is a
// named bundle of dashboard tab access an admin builds themselves (see
// PermissionSet's own comment in accounts-types.ts), assigned to users
// from their own profile page. is_superuser/is_platform_admin accounts
// bypass this entirely and don't need one.
//
// The table itself only ever shows the parent tabs (read-only — a plain
// check/cross, not a clickable toggle) — all actual editing, including
// the Courses/Users sub-permissions, happens through the Edit dialog
// (permission-set-form-dialog.tsx), which also doubles as the New
// permission set form so creating and editing look and work identically.
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
            Build named bundles of dashboard access, then assign one to each user from their profile page. Edit a
            set to grant specific tabs and, for Courses and Users, the finer actions on top of them.
          </p>
        </div>
        <PermissionSetFormDialog mode="create" />
      </div>

      <div className="mt-4 rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {PERMISSION_SET_SECTIONS.map((section) => (
                <TableHead key={section.tab} className="text-center">
                  {section.label}
                </TableHead>
              ))}
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {permissionSets.results.map((permissionSet) => (
              <TableRow key={permissionSet.id}>
                <TableCell className="font-medium">{permissionSet.name}</TableCell>
                {PERMISSION_SET_SECTIONS.map((section) => (
                  <TableCell key={section.tab} className="text-center">
                    {permissionSet[section.tab] ? (
                      <Check className="mx-auto h-4 w-4 text-primary" />
                    ) : (
                      <X className="mx-auto h-4 w-4 text-muted-foreground/40" />
                    )}
                  </TableCell>
                ))}
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <PermissionSetFormDialog mode="edit" permissionSet={permissionSet} />
                    <DeletePermissionSetButton permissionSetId={permissionSet.id} name={permissionSet.name} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {permissionSets.results.length === 0 && (
              <TableRow>
                <TableCell colSpan={PERMISSION_SET_SECTIONS.length + 2} className="text-center text-muted-foreground">
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
