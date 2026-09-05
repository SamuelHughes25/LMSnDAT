import { PortalShell } from "@/components/portal-shell";
import { getCurrentUser } from "@/lib/dal";

// The collapsible-sidebar shell (state, localStorage, the toggle tab) lives
// in portal-shell.tsx as a Client Component; this file stays a Server
// Component that fetches the user. No role redirect the other way:
// admins/managers are allowed to view the portal too (useful for previewing
// what an operative sees), only members are bounced *out* of the admin
// dashboard (see (dashboard)/layout.tsx).
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const displayName = `${user.first_name} ${user.last_name}`.trim() || user.username;

  return (
    <PortalShell displayName={displayName} role={user.role}>
      {children}
    </PortalShell>
  );
}
