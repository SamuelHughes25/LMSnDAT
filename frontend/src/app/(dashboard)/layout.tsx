import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { getCurrentUser } from "@/lib/dal";

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/templates", label: "Templates" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r bg-muted/20 p-4">
        <div className="mb-6 px-2 text-sm font-semibold">LMS</div>
        <nav className="space-y-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block rounded px-2 py-1.5 text-sm hover:bg-muted"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b p-4">
          <div className="text-sm text-muted-foreground">
            {user.username} <span className="capitalize">· {user.role}</span>
          </div>
          <LogoutButton />
        </header>
        <main className="flex-1 bg-muted/30 p-6">{children}</main>
      </div>
    </div>
  );
}
