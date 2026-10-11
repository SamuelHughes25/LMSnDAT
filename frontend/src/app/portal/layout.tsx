import { AppShell } from "@/components/app-shell";
import { getUserTierLabel } from "@/lib/accounts-types";
import { getCurrentUser } from "@/lib/dal";

// Mirrors (dashboard)/layout.tsx exactly — both route groups render the
// SAME shared shell now (see app-shell.tsx), so an office user browsing
// here (e.g. to preview what an operative sees) and an operative browsing
// here get identical chrome, just with different Manage-section visibility
// depending on accessible_tabs.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const displayName = `${user.first_name} ${user.last_name}`.trim() || user.username;

  return (
    <AppShell displayName={displayName} tierLabel={getUserTierLabel(user)} accessibleTabs={user.accessible_tabs}>
      {children}
    </AppShell>
  );
}
