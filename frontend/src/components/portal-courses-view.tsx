"use client";

import Link from "next/link";
import { AlertTriangle, BookOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ViewToggle } from "@/components/view-toggle";
import { useViewMode } from "@/lib/use-view-mode";
import { cn } from "@/lib/utils";

// Plain, pre-computed data only — lib/course-reminders.ts is server-only
// (it hits Django directly), so the server page component resolves every
// course's reminder/deadline state into this shape before handing it to
// this client component. Keeps this file a pure renderer with no data
// fetching of its own.
export type PortalCourseCardData = {
  id: string;
  name: string;
  description: string;
  thumbnail: string | null;
  // Null means "not yet published" — rendered as a disabled, unlinked card
  // in both views rather than hidden entirely, same as before this file
  // existed.
  href: string | null;
  badgeLabel: "Overdue" | "Action needed" | null;
  reminderReason: string | null;
  deadlineLabel: string | null;
  deadlineOverdue: boolean;
};

const VIEW_STORAGE_KEY = "portal-courses-view";

// Two layouts for the same course list: "Compact" (the original 2/3-column
// card grid, small buttons) for scanning many courses at a glance, and
// "Normal" (large single-column rows with a picture) for a more deliberate,
// browse-one-at-a-time feel. See use-view-mode.ts for the shared
// state/storage hook every Compact/Normal list page in this app uses.
export function PortalCoursesView({
  items,
  emptyMessage,
}: {
  items: PortalCourseCardData[];
  emptyMessage: string;
}) {
  const [view, setView] = useViewMode(VIEW_STORAGE_KEY);

  return (
    <div className="space-y-4">
      <ViewToggle view={view} onChange={setView} />

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : view === "compact" ? (
        <CompactGrid items={items} />
      ) : (
        <NormalList items={items} />
      )}
    </div>
  );
}

// "Overdue" uses the Badge component's own destructive (red) variant;
// "Action needed" previously used "secondary" — the same muted grey as
// every other non-alerting badge in this app — which made it barely
// distinguishable from ordinary metadata. It gets its own amber styling
// here instead (same "bg-X/10 text-X, dark:bg-X/20" shape the destructive
// variant itself uses, just amber instead of red) so it reads as a real,
// yellow-level warning rather than a passive label.
function ReminderBadge({ item }: { item: PortalCourseCardData }) {
  if (!item.badgeLabel) return null;
  const isOverdue = item.badgeLabel === "Overdue";
  return (
    <Badge
      variant={isOverdue ? "destructive" : "secondary"}
      className={cn(
        "gap-1",
        !isOverdue &&
          "bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
      )}
    >
      <AlertTriangle className="h-3 w-3" />
      {item.badgeLabel}
    </Badge>
  );
}

// The original card grid — unchanged in spirit, just: (1) the name span now
// has min-w-0 so `truncate` can actually take effect on a long course name
// instead of overflowing the card (a plain flex item's default min-width is
// its content's own size, which defeats truncation entirely — the same fix
// already applied to the course player header's h1), and (2) an explicit
// small "Start" button in the bottom-right corner, not just a whole-card
// click target.
function CompactGrid({ items }: { items: PortalCourseCardData[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => {
        const card = (
          <Card
            className={cn(
              "flex h-full flex-col",
              item.href ? "transition-colors hover:bg-muted/40" : "opacity-60",
            )}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <p className="line-clamp-2 text-sm text-muted-foreground">{item.description || " "}</p>
              {!item.href && (
                <Badge variant="outline" className="mt-2 w-fit">
                  Not yet published
                </Badge>
              )}
              {item.href && item.badgeLabel && (
                <div className="mt-2 space-y-1">
                  <ReminderBadge item={item} />
                  <p className="text-xs text-muted-foreground">{item.reminderReason}</p>
                  {item.deadlineLabel && (
                    <p
                      className={cn(
                        "text-xs font-medium",
                        item.deadlineOverdue ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {item.deadlineLabel}
                    </p>
                  )}
                </div>
              )}
              {item.href && (
                // A styled span, not a real <button> — this whole card is
                // already one big <Link> (below), and a <button> nested
                // inside an <a> is invalid HTML. buttonVariants gives it the
                // same look without a second, illegally-nested interactive
                // element.
                <span className={cn(buttonVariants({ size: "xs" }), "mt-auto ml-auto w-fit")}>Start</span>
              )}
            </CardContent>
          </Card>
        );
        return item.href ? (
          <Link key={item.id} href={item.href}>
            {card}
          </Link>
        ) : (
          <div key={item.id}>{card}</div>
        );
      })}
    </div>
  );
}

// The new "Normal" view — one large row per course instead of a grid cell,
// with room for a picture. Deliberately not a literal <table>: a real
// picture plus wrapping badge/reason text doesn't fit table cells' single-
// line-per-row assumption nearly as well as a flex row does, and this reads
// just as much like "a big table" to a viewer as an actual <table> would.
function NormalList({ items }: { items: PortalCourseCardData[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const row = (
          <div
            className={cn(
              "flex items-center gap-4 rounded-lg border-2 border-border bg-card p-4 shadow-sm",
              item.href ? "transition-colors hover:bg-muted/40" : "opacity-60",
            )}
          >
            <div className="h-20 w-32 shrink-0 overflow-hidden rounded-md bg-muted">
              {item.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- an admin-uploaded asset URL, not a static/known-domain import next/image can optimize.
                <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <BookOpen className="h-8 w-8 text-muted-foreground/40" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">{item.name}</div>
              <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{item.description || " "}</p>
              {!item.href ? (
                <Badge variant="outline" className="mt-2 w-fit">
                  Not yet published
                </Badge>
              ) : (
                item.badgeLabel && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ReminderBadge item={item} />
                    <span className="text-sm text-muted-foreground">{item.reminderReason}</span>
                    {item.deadlineLabel && (
                      <span
                        className={cn(
                          "text-sm font-medium",
                          item.deadlineOverdue ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {item.deadlineLabel}
                      </span>
                    )}
                  </div>
                )
              )}
            </div>

            {/* Larger than Compact's own "Start" — see that button's own
                comment for why this is a styled span, not a real <button>. */}
            {item.href && <span className={cn(buttonVariants({ size: "default" }), "shrink-0")}>Start</span>}
          </div>
        );
        return item.href ? (
          <Link key={item.id} href={item.href}>
            {row}
          </Link>
        ) : (
          <div key={item.id}>{row}</div>
        );
      })}
    </div>
  );
}
