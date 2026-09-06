import { Badge } from "@/components/ui/badge";
import { DeleteUserButton } from "@/components/delete-user-button";
import { InlineJobRoleSelect } from "@/components/inline-job-role-select";
import { JobRoleFilterSelect } from "@/components/job-role-filter-select";
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
import type { AccountUser, JobRole } from "@/lib/accounts-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// Search-by-username and filter-by-role are forwarded as query params to
// Django's /users/ endpoint (see UserViewSet.get_queryset() for the
// matching ?search=/?job_role= handling) rather than filtered client-side
// — same "Server Component reads searchParams, refetches" pattern as
// every other data-driven page in this app, just the first one that reads
// searchParams at all.
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; job_role?: string }>;
}) {
  const { q, job_role: jobRoleFilter } = await searchParams;

  const query = new URLSearchParams();
  if (q) query.set("search", q);
  if (jobRoleFilter) query.set("job_role", jobRoleFilter);
  const queryString = query.toString();

  const [users, roles] = await Promise.all([
    djangoFetch<Paginated<AccountUser>>(`/users/${queryString ? `?${queryString}` : ""}`),
    djangoFetch<Paginated<JobRole>>("/job-roles/"),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <NewUserDialog roles={roles.results} />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <UsersSearchBar />
        <JobRoleFilterSelect roles={roles.results} />
      </div>

      <div className="mt-4 rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Permission</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.results.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.username}</TableCell>
                <TableCell>
                  <InlineJobRoleSelect userId={user.id} currentJobRoleId={user.job_role} roles={roles.results} />
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
            ))}
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
