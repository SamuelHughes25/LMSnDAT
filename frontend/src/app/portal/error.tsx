"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";

// Portal-side twin of (dashboard)/error.tsx — see that file's comment for
// why this exists at all (no boundary anywhere caught this before). More
// important here than on the admin side: this is the route tree the course
// PLAYER lives in (portal/courses/[id]/page.tsx), so an operative mid-course
// hitting an uncaught error — a stale attempt after it was completed
// elsewhere, a slide submit racing a deadline extension, anything — lands
// here with a way back to their course list instead of a dead page.
export default function PortalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-6 text-center shadow-sm">
      <AlertTriangle className="mb-3 h-8 w-8 text-destructive/70" />
      <div className="font-medium">Something went wrong</div>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        That didn&apos;t go through. Try again, or head back to your course list.
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
