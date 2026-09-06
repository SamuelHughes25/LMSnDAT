import { DeleteRoleButton } from "@/components/delete-role-button";
import { NewRoleDialog } from "@/components/new-role-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { JobRole } from "@/lib/accounts-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// CRUD-only (name/description) — actually assigning courses/templates to a
// role happens from each course's/template's own "Roles" tab (see
// (dashboard)/courses/[id]/(detail)/roles/page.tsx), not duplicated here,
// so this page's scope stays a plain list like Courses/Templates.
export default async function RolesPage() {
  const data = await djangoFetch<Paginated<JobRole>>("/job-roles/");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Roles</h1>
        <NewRoleDialog />
      </div>
      <div className="mt-4 rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Courses</TableHead>
              <TableHead>Templates</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.results.map((role) => (
              <TableRow key={role.id}>
                <TableCell className="font-medium">{role.name}</TableCell>
                <TableCell>{role.description || "—"}</TableCell>
                <TableCell>{role.courses.length}</TableCell>
                <TableCell>{role.templates.length}</TableCell>
                <TableCell>
                  <DeleteRoleButton roleId={role.id} roleName={role.name} />
                </TableCell>
              </TableRow>
            ))}
            {data.results.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No roles yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
