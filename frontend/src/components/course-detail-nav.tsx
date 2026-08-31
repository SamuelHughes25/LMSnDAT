"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Active-link detection needs usePathname(), so only this small nav is a
// Client Component — the rest of (detail)/layout.tsx stays a Server
// Component that fetches the course.
export function CourseDetailNav({ courseId }: { courseId: string }) {
  const pathname = usePathname();
  const base = `/courses/${courseId}`;

  const links = [
    { href: base, label: "Overview" },
    { href: `${base}/preview`, label: "Preview" },
    { href: `${base}/members`, label: "Members" },
    { href: `${base}/settings`, label: "Settings" },
    { href: `${base}/activity`, label: "Activity" },
    { href: `${base}/analytics`, label: "Analytics" },
  ];

  return (
    <nav className="w-48 shrink-0 space-y-1">
      {links.map((link) => {
        // Overview's href equals the base course URL, so it must match
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
