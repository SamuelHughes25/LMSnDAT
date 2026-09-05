import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { getCurrentUser } from "@/lib/dal";

// Mirrors (dashboard)/layout.tsx's exact shell (same sidebar width, same
// header layout) — deliberately kept in visual sync since this is the same
// app for a different audience, not a different product. No role redirect
// the other way: admins/managers are allowed to view the portal too (useful
// for previewing what an operative sees), only members are bounced *out* of
// the admin dashboard (see (dashboard)/layout.tsx).
const NAV_LINKS = [
  { href: "/portal", label: "Home" },
  { href: "/portal/courses", label: "Courses" },
  { href: "/portal/templates", label: "Templates" },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const displayName = `${user.first_name} ${user.last_name}`.trim() || user.username;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r bg-muted/20 p-4">
        <div className="mb-6 px-2 text-sm font-semibold">LMS</div>
        <nav className="space-y-1">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="block rounded px-2 py-1.5 text-sm hover:bg-muted">
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b p-4">
          <div className="text-sm text-muted-foreground">
            {displayName} <span className="capitalize">· {user.role}</span>
          </div>
          <LogoutButton />
        </header>
        <main className="flex-1 bg-muted/30 p-6">{children}</main>
      </div>
    </div>
  );
}
