"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { FullscreenToggle } from "@/components/fullscreen-toggle";
import { LogoutButton } from "@/components/logout-button";
import { RefreshButton } from "@/components/refresh-button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { AccountUser } from "@/lib/accounts-types";
import { useIsClient } from "@/lib/use-is-client";
import { cn } from "@/lib/utils";

type Tab = AccountUser["accessible_tabs"][number];

// Every account — operative or office user alike — gets the SAME top-level
// items now: Dashboard (branches its own content by role, see
// (dashboard)/dashboard/page.tsx), and Templates/Courses, which always
// point at the "what's assigned to me" view (the former portal pages,
// unchanged) rather than the authoring tools. Nobody picks a role to see
// these — there's nothing to gate, every account has content assigned to
// it or doesn't. "/" itself moved to the public marketing home page (see
// app/(marketing)) — signed-in users never land there, so it's no longer
// what "Dashboard" points at.
const TOP_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/portal/templates", label: "Templates" },
  { href: "/portal/courses", label: "Courses" },
];

// The authoring/admin tools — unchanged routes, just regrouped under one
// visually separate "Manage" heading instead of being the top-level nav
// outright (that's what TOP_LINKS replaces them with). Each still gated on
// its own accessible_tabs entry exactly as before (see
// apps.core.permissions.user_can_access_tab on the backend) — an operative
// granted is_platform_admin now sees this whole section appear, which
// didn't use to be reachable at all (the dashboard route group used to
// hard-redirect any role==="member" account straight to /portal regardless
// of what permissions they'd been granted — see (dashboard)/layout.tsx's
// git history for that line).
const MANAGE_LINKS: { href: string; label: string; tab: Tab }[] = [
  { href: "/templates", label: "Templates", tab: "templates" },
  { href: "/courses", label: "Courses", tab: "courses" },
  { href: "/users", label: "Users", tab: "users" },
  { href: "/groups", label: "Groups", tab: "groups" },
  { href: "/permissions", label: "Permissions", tab: "permissions" },
];

const COLLAPSED_STORAGE_KEY = "app-sidebar-collapsed";

// Matches exactly the course-player route (`/portal/courses/:id`), not the
// courses list (`/portal/courses`) itself — that's the one page meant to
// feel like a full-screen presentation rather than a page alongside
// navigation. A plain string-prefix check would also match the list page
// (both start with "/portal/courses"), which is why this needs the extra
// path segment. Scoped to the portal course player specifically, same as
// before this shell was unified — the admin side's own course preview tab
// lives inside its own nested (detail) layout with its own tab strip, not
// this top-level sidebar, so it was never part of this collapse behavior
// and still isn't.
const COURSE_PLAYER_PATH = /^\/portal\/courses\/[^/]+\/?$/;

// The one shell every route now renders through — (dashboard)/layout.tsx
// and portal/layout.tsx both wrap their own route group's pages in this,
// passing the same user-derived props, rather than two independently
// maintained sidebars that could drift (and did: this is what let the
// dashboard side hard-redirect members away before they could ever reach
// anything a grant might have opened up for them). The two route groups
// themselves are untouched — same URLs, same pages — only the chrome
// around them is now shared.
export function AppShell({
  displayName,
  tierLabel,
  accessibleTabs,
  hasManageableCourses,
  hasManageableTemplates,
  children,
}: {
  displayName: string;
  tierLabel: string;
  accessibleTabs: Tab[];
  // True if the viewer owns/edits at least one course/template but lacks
  // the full 'courses'/'templates' tab — see accounts-types.ts's
  // manageable_course_ids/manageable_template_ids comment. Just enough to
  // decide whether the "Courses"/"Templates" Manage link shows at all; the
  // courses/templates list pages themselves re-fetch and filter down to
  // the actual ids (see (dashboard)/courses/page.tsx).
  hasManageableCourses?: boolean;
  hasManageableTemplates?: boolean;
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
  // leave every other page collapsed too, which is what writing to
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

  // A tab-less owner/editor still gets the "Courses"/"Templates" link —
  // it just points at a scoped-down page instead of the full catalog (see
  // courses/page.tsx and templates/page.tsx's own filtering). Checked
  // per-link via its own `tab`, not a blanket OR, so an editor-only grant
  // never leaks a "Users"/"Groups" link that has nothing to do with it.
  const visibleManageLinks = MANAGE_LINKS.filter(
    (link) =>
      accessibleTabs.includes(link.tab) ||
      (link.tab === "courses" && hasManageableCourses) ||
      (link.tab === "templates" && hasManageableTemplates),
  );
  // The whole "Manage" section (heading included) disappears for an
  // account with no manage-tab access at all, rather than rendering an
  // empty heading over nothing — an operative with zero grants (the
  // common case) sees exactly TOP_LINKS and nothing else below it.
  const hasAnyManageAccess = visibleManageLinks.length > 0 || accessibleTabs.includes("archive");

  return (
    // h-screen + overflow-hidden (not min-h-screen, which let the whole
    // document — sidebar and header included — grow past the viewport and
    // scroll away together) pins this chrome to exactly the viewport's
    // height; only `main` scrolls internally when a page's own content
    // doesn't fit. See course-preview-viewer.tsx's useStageScale for why
    // the course player specifically needed this: without a genuinely
    // bounded-height `main`, its own Next/Previous controls could push
    // below the fold.
    <div className="flex h-screen overflow-hidden">
      <div className="relative shrink-0">
        <aside
          className={cn(
            "flex h-full flex-col overflow-hidden border-r bg-muted/20 transition-[width] duration-200",
            effectiveCollapsed ? "w-0" : "w-56 p-4",
          )}
        >
          {/* w-56 fixed, not w-full: collapsing animates THIS inner content's
              own width toward 0 would squash/wrap the nav text mid-transition
              — keeping it at a constant width and letting the OUTER <aside>
              clip it via overflow-hidden instead means the content never
              visibly reflows, it just slides out of view. */}
          <div className="flex h-full w-56 flex-col overflow-y-auto">
            <div className="mb-6 px-2 text-sm font-semibold">LMS</div>
            <nav className="space-y-1">
              {TOP_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block rounded px-2 py-1.5 text-sm hover:bg-muted"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            {hasAnyManageAccess && (
              <nav className="mt-6 space-y-1 border-t pt-4">
                <div className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Manage
                </div>
                {visibleManageLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="block rounded px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    {link.label}
                  </Link>
                ))}
                {/* Pinned to the bottom of the Manage subsection, visually
                    separated — a restore-only utility for already-archived
                    courses/templates/users, not something that belongs
                    mixed in with daily management nav. Gated on the
                    'archive' tab specifically (see UserViewSet/
                    CourseViewSet/TemplateViewSet's HasArchiveTabAccess
                    usage), not just general manage access. */}
                {accessibleTabs.includes("archive") && (
                  <Link href="/archive" className="block rounded px-2 py-1.5 text-sm hover:bg-muted">
                    Archive
                  </Link>
                )}
              </nav>
            )}
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

      {/* min-w-0 — without it, this flex-row item defaults to
          min-width:auto, so a wide-enough page (any fixed-width content
          that doesn't wrap, like analytics-stat-slider.tsx's card track)
          lets this column grow past the space actually available next to
          the sidebar instead of shrinking to it. The outer shell's own
          overflow-hidden then just CLIPS that extra width at the browser
          edge rather than scrolling to it — confirmed as exactly what cut
          the analytics page's stat slider's own right-scroll button off
          the edge of the screen instead of the slider scrolling to reveal
          it internally, as main's own overflow-y-auto sibling rule
          (overflow-x computes to auto, not visible, once overflow-y is
          set) already intends for any content that genuinely needs it. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Hidden on the course player specifically — one more "give the
            content the whole screen" request on top of the sidebar
            auto-collapse above, and it's not just wasted space here: with
            no header, `main` (already min-h-0 flex-1, the only remaining
            item in this column) simply grows to fill the rest of the
            column on its own, no extra sizing needed. It reappears the
            moment the route stops matching COURSE_PLAYER_PATH — e.g.
            clicking the player's own "Back to courses" link — since this
            is the same isCoursePlayer check the effect above already
            reacts to on every navigation. */}
        {!isCoursePlayer && (
          <header className="flex shrink-0 items-center justify-between border-b p-4">
            {/* Links to the shared /account page — every account manages
                its own password there now; see that page's own comment. */}
            <Link href="/account" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              {displayName} · {tierLabel}
            </Link>
            <div className="flex items-center gap-2">
              <RefreshButton />
              <FullscreenToggle />
              <ThemeToggle />
              <LogoutButton />
            </div>
          </header>
        )}
        {/* Padding shrinks on the course player specifically — the same
            "every pixel here is a pixel the canvas doesn't get" reasoning as
            the header/title row inside the player page itself. Every other
            page keeps the original p-6 breathing room; only the player is
            meant to feel close to edge-to-edge. pl-6 (rather than plain p-2
            on all sides) gives the "Back to courses" link in the page's own
            header row more room from the sidebar edge — p-2 alone read as
            uncomfortably tight there, and pl-3 was still too tight per
            follow-up feedback. */}
        <main className={cn("min-h-0 flex-1 overflow-y-auto bg-muted/30", isCoursePlayer ? "p-2 pl-6" : "p-6")}>
          {children}
        </main>
      </div>
    </div>
  );
}
