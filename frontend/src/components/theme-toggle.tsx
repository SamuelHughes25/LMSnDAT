"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useIsClient } from "@/lib/use-is-client";

export const THEME_STORAGE_KEY = "lms-theme";

// Class-based dark mode — globals.css already ships a complete `.dark {
// ... }` variable set (the default shadcn/ui scaffold), so every component
// already using semantic color classes (bg-background, text-foreground,
// bg-muted, border-border, etc. — confirmed to be the pattern used
// throughout this app's own components) picks up dark mode automatically
// the moment `.dark` lands on <html>; this component's only job is
// deciding when that happens. No next-themes or other library: the exact
// same plain useState+localStorage pattern portal-shell.tsx already uses
// for its own sidebar-collapse preference, just applied to
// document.documentElement.classList instead of a React-rendered
// className, since <html> isn't part of this component's own render tree
// — a genuine "synchronize with an external system" case, which is what
// useEffect is actually meant for (unlike setState-in-an-effect for
// React-rendered content, which this app avoids elsewhere).
//
// See layout.tsx's blocking inline <script> for the other half of this:
// applying the stored preference there too, synchronously before first
// paint, is what avoids a flash of the wrong theme for a returning
// dark-mode viewer (this component alone would only apply it after
// hydration, one paint too late).
export function ThemeToggle() {
  const isClient = useIsClient();
  const [isDark, setIsDark] = useState(false);
  const [appliedStoredValue, setAppliedStoredValue] = useState(false);

  // Server-rendered (and the client's very first paint) always assume
  // light — there's no meaningful "server" theme — then the real stored
  // preference is applied by adjusting state during render, same
  // "sanctioned alternative to setState-in-an-effect" pattern
  // portal-shell.tsx already uses for appliedStoredValue there.
  if (isClient && !appliedStoredValue) {
    setAppliedStoredValue(true);
    try {
      setIsDark(localStorage.getItem(THEME_STORAGE_KEY) === "dark");
    } catch {
      // Ignore — private browsing / storage blocked; stays light.
    }
  }

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  function toggle() {
    setIsDark((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
      } catch {
        // Ignore — nothing to persist to, the toggle still works this visit.
      }
      return next;
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
