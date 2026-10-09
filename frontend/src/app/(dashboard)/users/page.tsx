import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { DeleteUserButton } from "@/components/delete-user-button";
import { GroupFilterSelect } from "@/components/group-filter-select";
import { NewUserDialog } from "@/components/new-user-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UsersSearchBar } from "@/components/users-search-bar";
import type { AccountUser, Group } from "@/lib/accounts-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// Search-by-username and filter-by-group are forwarded as query params to
// Django's /users/ endpoint (see UserViewSet.get_queryset() for the
// matching ?search=/?group= handling) rather than filtered client-side —
// same "Server Component reads searchParams, refetches" pattern as every
// other data-driven page in this app.
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; group?: string }>;
}) {
  const { q, group: groupFilter } = await searchParams;

  const query = new URLSearchParams();
  if (q) query.set("search", q);
  if (groupFilter) query.set("group", groupFilter);
  const queryString = query.toString();

  const [users, groups] = await Promise.all([
    djangoFetch<Paginated<AccountUser>>(`/users/${queryString ? `?${queryString}` : ""}`),
    djangoFetch<Paginated<Group>>("/groups/"),
  ]);

  const groupById = new Map(groups.results.map((g) => [g.id, g]));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <NewUserDialog />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <UsersSearchBar />
        <GroupFilterSelect groups={groups.results} paramName="group" allLabel="All groups" />
      </div>

      <div className="mt-4 rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Groups</TableHead>
              <TableHead>Permission</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.results.map((user) => {
              // Plain display text, not an inline editable control — a
              // user can now belong to several groups at once, so there's
              // no longer a single value a dropdown could even represent;
              // editing lives on the user's own detail page.
              const userGroups = user.content_groups
                .map((id) => groupById.get(id))
                .filter((g): g is Group => !!g);
              return (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    <Link href={`/users/${user.id}`} className="hover:underline">
                      {user.username}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {userGroups.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {userGroups.map((group) => (
                          <Badge key={group.id} variant="secondary">
                            {group.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(user.date_joined).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <DeleteUserButton userId={user.id} username={user.username} />
                  </TableCell>
                </TableRow>
              );
            })}
            {users.results.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
