import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChangePasswordForm } from "@/components/change-password-form";
import { LogoutButton } from "@/components/logout-button";
import type { Group } from "@/lib/accounts-types";
import { getUserTierLabel } from "@/lib/accounts-types";
import { getCurrentUser } from "@/lib/dal";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// A top-level route, deliberately outside both the (dashboard) and portal/
// route groups — every account (an operative exactly as much as an office
// user) needs to be able to reach this to change their own password.
// Linked from AppShell's own header (the username · tier label, a link —
// see app-shell.tsx). No sidebar/nav of its own; just a Back link to
// "/dashboard", which now works for every account regardless of role (see
// (dashboard)/layout.tsx's own comment on the redirect this used to need
// and no longer does).
//
// The shape every account's own page is meant to have, per the request
// this was built from: account details, a password-change option, which
// groups they belong to, and a (for now inert) way to reach support —
// not an admin-facing view of someone ELSE's account (that's
// (dashboard)/users/[id], unrelated to this page).
export default async function AccountPage() {
  const [user, groups] = await Promise.all([
    getCurrentUser(),
    // IsAuthenticated covers list/retrieve on GroupViewSet (only
    // create/update/destroy are tab-gated — see its get_permissions), so
    // this resolves correctly even for an operative with no dashboard
    // access at all.
    djangoFetch<Paginated<Group>>("/groups/"),
  ]);
  const myGroups = groups.results.filter((g) => user.content_groups.includes(g.id));
  const fullName = `${user.first_name} ${user.last_name}`.trim();

  return (
    <div className="mx-auto max-w-md space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <LogoutButton />
      </div>

      <div>
        <h1 className="text-xl font-semibold">{user.username}</h1>
        <p className="text-sm text-muted-foreground">{getUserTierLabel(user)}</p>
      </div>

      <div className="space-y-3 rounded-lg border-2 border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-medium">Account details</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Username</dt>
            <dd>{user.username}</dd>
          </div>
          {fullName && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{fullName}</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="truncate">{user.email || "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Account type</dt>
            <dd>{getUserTierLabel(user)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Member since</dt>
            <dd>{new Date(user.date_joined).toLocaleDateString()}</dd>
          </div>
        </dl>
      </div>

      <div className="space-y-3 rounded-lg border-2 border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-medium">Groups</h2>
        {myGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">You&apos;re not a member of any group yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {myGroups.map((group) => (
              <Badge key={group.id} variant="secondary">
                {group.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border-2 border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-medium">Change password</h2>
        <ChangePasswordForm />
      </div>

      <div className="space-y-3 rounded-lg border-2 border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-medium">Support</h2>
        {/* Deliberately inert for now — wired up to an actual support
            channel later, not left out of this page entirely so the
            eventual hookup is just removing `disabled`, not a new feature
            to design from scratch. */}
        <Button type="button" variant="outline" disabled title="Coming soon" className="w-full">
          Contact support
        </Button>
      </div>
    </div>
  );
}
