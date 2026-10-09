import Link from "next/link";
import { redirect } from "next/navigation";

import { FullscreenToggle } from "@/components/fullscreen-toggle";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser } from "@/lib/dal";

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/templates", label: "Templates" },
  { href: "/courses", label: "Courses" },
  { href: "/users", label: "Users" },
  { href: "/groups", label: "Groups" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // This whole section is the authoring/admin tool — course/template
  // builders, delete buttons, etc. Members have no use for it (and would
  // just hit 403s from IsAdminOrReadOnly on any write), so they're bounced
  // to their own portal instead of landing here after login or navigating
  // back to "/".
  if (user.role === "member") redirect("/portal");

  return (
    // h-screen + overflow-hidden (not min-h-screen, which let the whole
    // document — sidebar and header included — grow past the viewport and
    // scroll away together) pins this chrome to exactly the viewport's
    // height; only `main` scrolls internally when a page's own content
    // doesn't fit. See portal-shell.tsx's identical fix for the matching
    // operative-side shell, and course-preview-viewer.tsx's useStageScale
    // for why the course preview tab specifically needed this: without a
    // genuinely bounded-height `main`, that tab's canvas had no real ceiling
    // to fit itself under and could push its own Next/Previous controls
    // below the fold.
    <div className="flex h-screen overflow-hidden">
      <aside className="w-56 shrink-0 overflow-y-auto border-r bg-muted/20 p-4">
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
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b p-4">
          <div className="text-sm text-muted-foreground">
            {user.username} <span className="capitalize">· {user.role}</span>
          </div>
          <div className="flex items-center gap-2">
            <FullscreenToggle />
            <ThemeToggle />
            <LogoutButton />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-6">{children}</main>
      </div>
    </div>
  );
}
