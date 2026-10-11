"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Every page in this app fetches its data server-side (Server Components,
// no client-side polling/refetching anywhere) — so a list like Users or a
// detail page like a user's own course history only ever shows what was
// current at the moment of the last navigation. Someone sitting on the
// Users tab watching for a course submission to come in had no way to see
// it land short of leaving the page and coming back. router.refresh() is
// Next's own mechanism for re-running every Server Component on the
// CURRENT route without a full reload (no state loss elsewhere in the
// tree, no URL change, no scroll jump) — exactly "pull in the updated
// data," for whatever page this happens to sit on.
//
// Lives once in app-shell.tsx's header (not copy-pasted onto Users/
// Courses/Templates/user-detail/analytics/activity individually) so it's
// available everywhere uniformly rather than only on whichever pages
// happened to remember to add it — every page here is a Server Component
// reading fresh data on every render, so there's nothing page-specific
// this button would ever need to know.
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      onClick={handleClick}
      disabled={pending}
      aria-label="Refresh this page's data"
      title="Refresh this page's data"
      className="shrink-0"
    >
      <RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} />
    </Button>
  );
}
