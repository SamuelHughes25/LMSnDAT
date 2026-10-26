import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { DeleteUserButton } from "@/components/delete-user-button";
import { NewUserDialog } from "@/components/new-user-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserFiltersPanel } from "@/components/user-filters-panel";
import { UsersSearchBar } from "@/components/users-search-bar";
import type { AccountUser, Group, PermissionSet } from "@/lib/accounts-types";
import { getUserKindLabel } from "@/lib/accounts-types";
import { getCurrentUser } from "@/lib/dal";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// A query param repeated in the URL (?group=a&group=b) is handed to a
// Server Component as a real string[] already — Next.js does this
// normalization itself, no manual parsing needed — but a param given
// exactly once still arrives as a bare string, and an absent one as
// undefined. UserFiltersPanel (the Filters button) always writes the
// repeated form via URLSearchParams, but a hand-typed/bookmarked URL with
// a single ?group=x is just as valid, so this normalizes either shape
// into a plain array before forwarding to Django.
function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Search-by-username and filter-by-group/permission-set/role are
// forwarded as query params to Django's /users/ endpoint (see
// UserViewSet.get_queryset() for the matching ?search=/?group=/
// ?permission_set=/?role= handling) rather than filtered client-side —
// same "Server Component reads searchParams, refetches" pattern as every
// other data-driven page in this app.
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; group?: string | string[]; permission_set?: string | string[]; role?: string | string[] }>;
}) {
  const { q, group: groupFilter, permission_set: permissionSetFilter, role: roleFilter } = await searchParams;

  const query = new URLSearchParams();
  if (q) query.set("search", q);
  for (const id of toArray(groupFilter)) query.append("group", id);
  for (const id of toArray(permissionSetFilter)) query.append("permission_set", id);
  for (const role of toArray(roleFilter)) query.append("role", role);
  const queryString = query.toString();

  const [users, groups, permissionSets, currentUser] = await Promise.all([
    djangoFetch<Paginated<AccountUser>>(`/users/${queryString ? `?${queryString}` : ""}`),
    djangoFetch<Paginated<Group>>("/groups/"),
    djangoFetch<Paginated<PermissionSet>>("/permission-sets/"),
    getCurrentUser(),
  ]);

  const groupById = new Map(groups.results.map((g) => [g.id, g]));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        {/* can_create_users — a separate sub-permission from plain
            can_access_users now, see PermissionSet's own comment. */}
        {currentUser.user_permissions.includes("create_users") && (
          <NewUserDialog permissionSets={permissionSets.results} />
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <UsersSearchBar />
        <UserFiltersPanel groups={groups.results} permissionSets={permissionSets.results} />
      </div>

      <div className="mt-4 rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Groups</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>Joined</TableHead>
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
                    <Badge variant="outline">{getUserKindLabel(user)}</Badge>
                  </TableCell>
                  <TableCell>
                    {/* Checked regardless of role now, not just for a
                        non-operative — an operative CAN be granted
                        is_superuser/is_platform_admin/a permission set same
                        as anyone else (see app-shell.tsx's unified nav,
                        which is what actually makes that grant DO
                        something now), so hiding it behind a role check
                        here was silently making a real grant look like it
                        hadn't taken effect. */}
                    {user.is_superuser ? (
                      <Badge>Super-super-user</Badge>
                    ) : user.is_platform_admin ? (
                      <Badge>Super user</Badge>
                    ) : user.permission_set_name ? (
                      <Badge variant="secondary">{user.permission_set_name}</Badge>
                    ) : (
                      <span className="text-muted-foreground">No access</span>
                    )}
                  </TableCell>
                  <TableCell>{new Date(user.date_joined).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {/* can_delete_users OR the Archive tab — either path
                        still reaches destroy/restore/purge server-side
                        (HasArchiveTabAccessOrCanDeleteUsers), so the
                        button stays hidden here only when NEITHER does. */}
                    {(currentUser.user_permissions.includes("delete_users") ||
                      currentUser.accessible_tabs.includes("archive")) && (
                      <DeleteUserButton
                        userId={user.id}
                        username={user.username}
                        disableSelf={user.id === currentUser.id}
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {users.results.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
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
