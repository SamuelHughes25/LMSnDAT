"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";

type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };

function getOrientation(): LockableOrientation | undefined {
  return typeof screen !== "undefined" ? (screen.orientation as LockableOrientation) : undefined;
}

// Mobile-only guard for the course/template builder specifically — reported
// as "awfully cramped" on a phone in portrait, unlike the home/login/portal
// pages, which are fine there. There's no way to force a genuine physical
// rotation, so this is two layers:
//
//  1. An opportunistic screen.orientation.lock("landscape") call below —
//     works on some Android browsers (usually only once the page is
//     fullscreen, which is why the manual retry button below requests
//     fullscreen first). Silently does nothing where it's unsupported or
//     refused; never surfaced as an error.
//  2. The overlay itself, driven PURELY by CSS (the hidden/portrait:max-
//     [899px]:flex classes below) — not JS/useState — so it matches the
//     device's actual physical orientation on the very first paint with no
//     hydration-mismatch flash, and keeps blocking the builder underneath
//     even on iOS Safari, which has no orientation-lock API at all (lock()
//     above is simply a no-op there — this overlay is the only thing that
//     actually guarantees the builder is never used cramped on an iPhone).
export function MobileLandscapeGate({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    getOrientation()
      ?.lock?.("landscape")
      .catch(() => {
        // Expected almost everywhere this isn't Android Chrome — see
        // comment above.
      });
  }, []);

  async function retryLock() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      await getOrientation()?.lock?.("landscape");
    } catch {
      // Expected on iOS Safari (no API at all) or if the browser refuses
      // fullscreen/lock from this gesture — the overlay's own instructions
      // are the real fallback either way.
    }
  }

  return (
    <>
      {/* `fixed`, not `absolute` — the builder content underneath is itself
          the reason this exists (it forces more width than a phone's
          portrait viewport gives it, producing horizontal overflow on its
          own positioned ancestor), so anchoring to that ancestor's box
          would size/place this overlay against the SAME overflowing
          content it's meant to cover, pushing its centered text off-screen
          to the right instead of over whatever's actually visible.
          `fixed` pins it to the real viewport regardless. */}
      <div
        className="hidden portrait:max-[899px]:flex fixed inset-0 z-50 flex-col items-center
          justify-center gap-4 bg-background p-8 text-center"
      >
        <RotateCw className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="text-lg font-medium">Rotate your device</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This editor needs more width than portrait mode gives it — turn your phone sideways to continue.
          </p>
        </div>
        <button
          type="button"
          onClick={retryLock}
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          Try locking landscape automatically
        </button>
      </div>
      {children}
    </>
  );
}
