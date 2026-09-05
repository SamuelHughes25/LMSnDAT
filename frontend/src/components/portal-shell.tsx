"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { LogoutButton } from "@/components/logout-button";
import { useIsClient } from "@/lib/use-is-client";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/portal", label: "Home" },
  { href: "/portal/courses", label: "Courses" },
  { href: "/portal/templates", label: "Templates" },
];

const COLLAPSED_STORAGE_KEY = "portal-sidebar-collapsed";

// Client Component specifically for the collapse toggle's state — the rest
// of portal/layout.tsx stays a Server Component that fetches the user.
// Persisted to localStorage (per-viewer convenience, not synced data) so
// the sidebar stays collapsed across a full reload/new visit, not just
// while navigating between Home/Courses/Templates within the same layout
// mount (which a plain useState would already survive on its own, since
// this layout doesn't remount between those).
export function PortalShell({
  displayName,
  role,
  children,
}: {
  displayName: string;
  role: string;
  children: React.ReactNode;
}) {
  // Server-rendered (and the client's very first paint) always show
  // expanded — there's no meaningful "server" collapse state, so this
  // avoids a hydration mismatch the same way useIsClient's own doc comment
  // describes. Once isClient flips true, the real stored preference is
  // applied by adjusting state during render (this project's sanctioned
  // alternative to setState-in-an-effect) — same shape as
  // missing-word-slide-face.tsx's isClient-gated shuffle-once pattern.
  const isClient = useIsClient();
  const [collapsed, setCollapsed] = useState(false);
  const [appliedStoredValue, setAppliedStoredValue] = useState(false);
  if (isClient && !appliedStoredValue) {
    setAppliedStoredValue(true);
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true");
    } catch {
      // Ignore — private browsing / storage blocked; stays expanded.
    }
  }

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // Ignore — nothing to persist to, the toggle still works this visit.
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-screen">
      <div className="relative shrink-0">
        <aside
          className={cn(
            "h-full overflow-hidden border-r bg-muted/20 transition-[width] duration-200",
            collapsed ? "w-0" : "w-56 p-4",
          )}
        >
          {/* w-56 fixed, not w-full: collapsing animates THIS inner content's
              own width toward 0 would squash/wrap the nav text mid-transition
              — keeping it at a constant width and letting the OUTER <aside>
              clip it via overflow-hidden instead means the content never
              visibly reflows, it just slides out of view. */}
          <div className="w-56">
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
          </div>
        </aside>

        {/* The "pop out and in again" tab — always visible regardless of
            collapse state, anchored to the sidebar's own right edge so it
            moves along with it as it collapses/expands. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute top-1/2 right-0 z-10 flex h-10 w-4 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b p-4">
          <div className="text-sm text-muted-foreground">
            {displayName} <span className="capitalize">· {role}</span>
          </div>
          <LogoutButton />
        </header>
        <main className="flex-1 bg-muted/30 p-6">{children}</main>
      </div>
    </div>
  );
}
