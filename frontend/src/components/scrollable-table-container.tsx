"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";

// However few rows a table has, it still reserves at least this much
// vertical space — a 1-row table looks exactly as substantial as a 50-row
// one, rather than visibly shrinking down to whatever its few rows need.
// Also the fallback before the real measurement below ever runs (SSR/
// first paint — window isn't available yet).
const MIN_HEIGHT = 320;

// Left below the table's resting bottom edge so it doesn't sit flush
// against the very edge of the browser window.
const BOTTOM_MARGIN = 24;

// Expanded is a fixed multiple of the resting height, not "remove the cap
// entirely" — big enough to dominate the page (the page itself now needs
// to scroll to see the rest of it, which is the whole point of
// "expand"/"take up most of the screen"), but still a real, bounded
// number rather than growing without limit as more rows get added.
const EXPANDED_MULTIPLIER = 2.5;

// Shared by every user table in the app (the main Users list, a Group's or
// Course's member list, course Analytics' per-user table, Archive's user
// table). Resting height reaches exactly to the bottom of the current
// viewport from wherever this table happens to start on the page —
// whatever's already visible before the PAGE itself would need to scroll
// — rather than a flat guessed pixel number that's cramped on a small
// laptop and wastes space on a tall monitor. "Show more" then multiplies
// that same measurement, growing well past one screen's worth so the
// table genuinely takes over most of the page rather than nudging a
// little taller. Wrap only the <Table> itself in this (not its outer
// bordered card div) — the toggle button renders as that card's own
// bottom edge, inside the existing border/rounding.
export function ScrollableTableContainer({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [restingHeight, setRestingHeight] = useState(MIN_HEIGHT);

  useEffect(() => {
    function measure() {
      const el = containerRef.current;
      if (!el) return;
      // Measured from the top of where this table ACTUALLY starts on the
      // page (not a fixed offset) — a table that spawns further down a
      // longer page correctly gets a shorter resting height than one that
      // starts right under the page header.
      const top = el.getBoundingClientRect().top;
      setRestingHeight(Math.max(MIN_HEIGHT, window.innerHeight - top - BOTTOM_MARGIN));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        className="overflow-y-auto"
        style={{ height: expanded ? restingHeight * EXPANDED_MULTIPLIER : restingHeight }}
      >
        {children}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="w-full rounded-none border-t border-border text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? (
          <>
            <ChevronsDownUp className="h-3.5 w-3.5" />
            Show less
          </>
        ) : (
          <>
            <ChevronsUpDown className="h-3.5 w-3.5" />
            Show more
          </>
        )}
      </Button>
    </div>
  );
}
