import { AppShell } from "@/components/app-shell";
import { getUserTierLabel } from "@/lib/accounts-types";
import { getCurrentUser } from "@/lib/dal";

// Every route under this group used to be hard-gated to non-member
// accounts (a `redirect("/portal")` right here) — removed. Access to
// anything under "Manage" is purely accessible_tabs-driven now (AppShell
// hides nav for whatever a viewer can't reach, and the backend's own
// per-endpoint permission checks are the real enforcement regardless of
// what the nav shows) — role no longer gates reaching these ROUTES at
// all, only what the shared AppShell nav offers to click into. This is
// what makes granting an operative is_platform_admin/a permission set
// actually DO something: before, they'd still get bounced straight back
// to /portal on the very next navigation no matter what they'd been
// granted.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <AppShell
      displayName={user.username}
      tierLabel={getUserTierLabel(user)}
      accessibleTabs={user.accessible_tabs}
      hasManageableCourses={user.manageable_course_ids.length > 0}
      hasManageableTemplates={user.manageable_template_ids.length > 0}
    >
      {children}
    </AppShell>
  );
}
