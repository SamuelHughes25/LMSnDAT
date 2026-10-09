"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";

// Catches any uncaught exception thrown while rendering (or inside a
// useTransition action — see course-access-cell.tsx and similar
// add/remove-style client components, none of which catch their own
// server-action errors) anywhere under the admin dashboard shell. Before
// this file existed, that class of error had NO boundary anywhere in the
// app — it fell all the way through to Next's unstyled default crash page,
// with no way back except a full reload. A double-click on an "Add" button
// racing a duplicate-assignment 400, or a manager's session losing its
// team mid-action, are both ordinary enough to hit this for real, not
// hypothetical.
//
// Error boundaries must be Client Components, and this one's `retry` prop
// (re-rendering the segment in place, no full reload) is this Next.js
// version's name for the callback — see node_modules/next/dist/docs/01-app/
// 01-getting-started/10-error-handling.md; older docs/training data call
// it `reset`.
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-6 text-center shadow-sm">
      <AlertTriangle className="mb-3 h-8 w-8 text-destructive/70" />
      <div className="font-medium">Something went wrong</div>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        That action didn&apos;t go through. This can happen if the data changed elsewhere in the meantime — try again.
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
