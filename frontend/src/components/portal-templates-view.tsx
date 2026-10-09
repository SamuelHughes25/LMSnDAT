"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ViewToggle } from "@/components/view-toggle";
import { useViewMode } from "@/lib/use-view-mode";
import { cn } from "@/lib/utils";

// Mirrors portal-courses-view.tsx exactly in spirit, but templates carry no
// reminder/deadline/thumbnail state at all — so this is the simpler of the
// two: just a name/description and a Fill/Not-yet-published state. The
// Normal view's picture slot always shows the same placeholder icon (there's
// no Template.thumbnail field, unlike Course) rather than being skipped —
// keeps the two rows' shapes identical whether or not a course-side picture
// feature ever gets a template equivalent.
export type PortalTemplateCardData = {
  id: string;
  name: string;
  description: string;
  // Null means "not yet published" — rendered as a disabled, unlinked card
  // in both views rather than hidden entirely.
  href: string | null;
};

const VIEW_STORAGE_KEY = "portal-templates-view";

export function PortalTemplatesView({
  items,
  emptyMessage,
}: {
  items: PortalTemplateCardData[];
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

function CompactGrid({ items }: { items: PortalTemplateCardData[] }) {
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
                <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" />
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
              {item.href && (
                <span className={cn(buttonVariants({ size: "xs" }), "mt-auto ml-auto w-fit")}>Fill out</span>
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

function NormalList({ items }: { items: PortalTemplateCardData[] }) {
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
            <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
              <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">{item.name}</div>
              <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{item.description || " "}</p>
              {!item.href && (
                <Badge variant="outline" className="mt-2 w-fit">
                  Not yet published
                </Badge>
              )}
            </div>

            {item.href && <span className={cn(buttonVariants({ size: "default" }), "shrink-0")}>Fill out</span>}
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
