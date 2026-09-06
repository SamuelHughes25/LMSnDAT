"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

// Matches exactly the course-player route (/portal/courses/:id`), not the
// courses list (`/portal/courses`) itself — that's the one page meant to
// feel like a full-screen presentation rather than a page alongside
// navigation. A plain string-prefix check would also match the list page
// (both start with "/portal/courses"), which is why this needs the extra
// path segment.
const COURSE_PLAYER_PATH = /^\/portal\/courses\/[^/]+\/?$/;

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

  // The course player auto-collapses the sidebar (a presentation-mode-style
  // "give the content the whole screen" request) WITHOUT touching the
  // persisted `collapsed` preference above — leaving a course shouldn't
  // leave every other portal page collapsed too, which is what writing to
  // `collapsed`/localStorage here would do. `expandedOverride` is a plain,
  // never-persisted "the viewer chose to expand it anyway, just for this
  // page visit" escape hatch, reset every time the route itself changes
  // (including navigating from one course to another) so re-entering a
  // player always starts collapsed again. Reset during render (comparing
  // against a stored previous pathname) rather than in a useEffect — same
  // "adjust state during render" pattern this component already uses for
  // appliedStoredValue above, this project's sanctioned alternative to a
  // setState-in-an-effect for "reset this state when a prop/route changes."
  const pathname = usePathname();
  const isCoursePlayer = COURSE_PLAYER_PATH.test(pathname ?? "");
  const [prevPathname, setPrevPathname] = useState(pathname);
  const [expandedOverride, setExpandedOverride] = useState(false);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setExpandedOverride(false);
  }

  const effectiveCollapsed = isCoursePlayer ? !expandedOverride : collapsed;

  function toggle() {
    if (isCoursePlayer) {
      setExpandedOverride((prev) => !prev);
      return;
    }
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
            effectiveCollapsed ? "w-0" : "w-56 p-4",
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
            moves along with it as it collapses/expands. Sized well above the
            old 40x16px pill (confirmed in a real browser to be genuinely
            hard to spot, especially once collapsed and floating alone in an
            otherwise-empty strip) and filled solid whenever the sidebar is
            actually collapsed — that's the one moment this button is the
            ONLY way back to the nav, so it earns the extra visual weight the
            plain outline treatment doesn't give it. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={effectiveCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={effectiveCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "absolute top-1/2 right-0 z-10 flex h-16 w-7 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border shadow-md transition-colors",
            effectiveCollapsed
              ? "border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          {effectiveCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
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
