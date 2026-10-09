"use client";

import { useState } from "react";

import { useIsClient } from "@/lib/use-is-client";

export type ViewMode = "compact" | "normal";

// Shared by every Compact/Normal list-view toggle in this app (portal
// courses, portal templates, admin courses, admin templates) — a
// per-browser display preference, not real data, so localStorage rather
// than a server round-trip. Wrapped in try/catch since private-browsing or
// storage-disabled contexts can throw on either read or write; the toggle
// still works for the rest of the session either way, it just won't
// persist across a reload.
//
// Applies the stored value by adjusting state during render (guarded by
// `appliedStoredValue`), not in a useEffect — this project's sanctioned
// alternative to setState-in-an-effect (see theme-toggle.tsx's own comment
// for the fuller rationale); `useIsClient` is what makes this safe against
// a hydration mismatch, since the server has no meaningful stored value at
// all.
export function useViewMode(storageKey: string): [ViewMode, (next: ViewMode) => void] {
  const isClient = useIsClient();
  const [view, setView] = useState<ViewMode>("compact");
  const [appliedStoredValue, setAppliedStoredValue] = useState(false);

  if (isClient && !appliedStoredValue) {
    setAppliedStoredValue(true);
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "compact" || stored === "normal") setView(stored);
    } catch {
      // Keep the default.
    }
  }

  function setViewPersisted(next: ViewMode) {
    setView(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Best-effort only — the toggle still works for the rest of this session.
    }
  }

  return [view, setViewPersisted];
}
