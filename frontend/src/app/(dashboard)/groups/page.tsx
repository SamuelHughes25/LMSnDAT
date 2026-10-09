import Link from "next/link";

import { DeleteGroupButton } from "@/components/delete-group-button";
import { NewGroupDialog } from "@/components/new-group-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Group } from "@/lib/accounts-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// This top-level list stays CRUD-only (name/description) — assigning
// courses/templates to a group happens from each course's/template's own
// "Roles" tab (see (dashboard)/courses/[id]/(detail)/roles/page.tsx), not
// duplicated here. Clicking a group's name drills into groups/[id]/page.tsx
// for the full picture (every course, template, and user actually in it).
// One list, not two — a group bundles both courses AND templates together
// as one assignable unit (e.g. "Commercial Dwelling Engineer" carries both
// its training courses and its audit templates), so there's nothing to
// split by kind here.
export default async function GroupsPage() {
  const groups = await djangoFetch<Paginated<Group>>("/groups/");

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Groups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each group bundles whatever mix of courses and templates its owner decides — a user can belong to
            any number of groups at once.
          </p>
        </div>
        <NewGroupDialog />
      </div>
      <div className="mt-4 rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Courses</TableHead>
              <TableHead>Templates</TableHead>
              <TableHead>Members</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.results.map((group) => (
              <TableRow key={group.id}>
                <TableCell className="font-medium">
                  <Link href={`/groups/${group.id}`} className="hover:underline">
                    {group.name}
                  </Link>
                </TableCell>
                <TableCell>{group.description || "—"}</TableCell>
                <TableCell>{group.courses.length}</TableCell>
                <TableCell>{group.templates.length}</TableCell>
                <TableCell>{group.member_count}</TableCell>
                <TableCell>
                  <DeleteGroupButton groupId={group.id} groupName={group.name} />
                </TableCell>
              </TableRow>
            ))}
            {groups.results.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No groups yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
