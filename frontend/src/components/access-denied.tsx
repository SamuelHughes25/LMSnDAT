import Link from "next/link";
import { ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";

// The shared "you don't have permission to view this" state — same card
// shape as (dashboard)/error.tsx's own crash boundary (h-64, centered icon
// + heading + copy + one action), deliberately NOT that same component:
// this isn't a transient failure a retry could fix, it's a genuine,
// durable "no" — the one actionable thing here is leaving, not trying
// again. Used by every dashboard page/tab and course/template sub-tab that
// gates on a specific permission (see lib/role-access.ts's hasTabAccess,
// and each Course/Template's own server-computed viewer_can_edit_* fields)
// — rendered directly in place of the real page content rather than a
// redirect, so a user who reaches a page they can't use (a stale link, a
// bookmark, a prompt that shouldn't have been shown — see
// course-detail-nav.tsx's own history) gets an explicit, honest reason
// instead of being silently bounced somewhere else with no explanation.
export function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-6 text-center shadow-sm">
      <ShieldX className="mb-3 h-8 w-8 text-destructive/70" />
      <div className="font-medium">Access denied</div>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {message ?? "You don't have permission to view this page."}
      </p>
      <Button variant="outline" size="sm" className="mt-4" render={<Link href="/dashboard" />}>
        Back to dashboard
      </Button>
    </div>
  );
}
