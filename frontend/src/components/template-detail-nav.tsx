"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Mirrors course-detail-nav.tsx exactly — same active-link logic, same
// tab set, kept as its own Client Component for the same reason (only
// usePathname() needs the client boundary; the layout stays a Server
// Component that fetches the template).
export function TemplateDetailNav({ templateId }: { templateId: string }) {
  const pathname = usePathname();
  const base = `/templates/${templateId}`;

  const links = [
    { href: base, label: "Overview" },
    { href: `${base}/preview`, label: "Preview" },
    { href: `${base}/members`, label: "Members" },
    { href: `${base}/roles`, label: "Groups" },
    { href: `${base}/settings`, label: "Settings" },
    { href: `${base}/activity`, label: "Activity" },
    { href: `${base}/analytics`, label: "Analytics" },
  ];

  return (
    <nav className="w-48 shrink-0 space-y-1">
      {links.map((link) => {
        // Overview's href equals the base template URL, so it must match
        // exactly (not by prefix) or every sub-page would highlight it too.
        const isActive = link.href === base ? pathname === base : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "block rounded-md px-3 py-1.5 text-sm",
              isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
