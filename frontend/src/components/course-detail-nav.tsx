"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Active-link detection needs usePathname(), so only this small nav is a
// Client Component — the rest of (detail)/layout.tsx stays a Server
// Component that fetches the course.
export function CourseDetailNav({
  courseId,
  canEditMembers,
  canEditGroups,
  canEditSettings,
  canViewVersionHistory,
}: {
  courseId: string;
  // Members/Groups/Settings used to be shown to every viewer regardless —
  // reported directly as the actual bug (the Groups link reachable, and
  // prompted to from an empty-state dialog, by someone without
  // can_edit_course_groups at all) and fixed the same way
  // canViewVersionHistory already was here: hide the link entirely rather
  // than show it disabled, since the page behind it is now a hard
  // <AccessDenied /> gate (see members/roles/settings page.tsx's own
  // comments) that would just refuse anyone who typed/bookmarked the URL
  // anyway.
  canEditMembers: boolean;
  canEditGroups: boolean;
  canEditSettings: boolean;
  canViewVersionHistory: boolean;
}) {
  const pathname = usePathname();
  const base = `/courses/${courseId}`;

  const links = [
    { href: base, label: "Overview" },
    { href: `${base}/preview`, label: "Preview" },
    ...(canEditMembers ? [{ href: `${base}/members`, label: "Members" }] : []),
    ...(canEditGroups ? [{ href: `${base}/roles`, label: "Groups" }] : []),
    ...(canEditSettings ? [{ href: `${base}/settings`, label: "Settings" }] : []),
    ...(canViewVersionHistory ? [{ href: `${base}/version-history`, label: "Version history" }] : []),
    { href: `${base}/analytics`, label: "Analytics" },
  ];

  return (
    // w-40 (was w-48) — every label here ("Analytics" is the longest) fits
    // comfortably well under this with room to spare, so the extra 32px
    // was just unused whitespace; freeing it gives the content column next
    // to this nav (particularly analytics-stat-slider.tsx's own card
    // track) a little more room before it needs to fade/scroll its own
    // content — reported directly as a way to claw back space for it.
    <nav className="w-40 shrink-0 space-y-1">
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
