"use client";

import { useEffect, useState } from "react";
import { Maximize, Minimize } from "lucide-react";

import { Button } from "@/components/ui/button";

// Fullscreens the WHOLE page (document.documentElement) rather than just
// this component's own container — that's the part of "give the page more
// room" no amount of internal padding/margin trimming could ever reach,
// since it hides the browser's own chrome (address bar, tabs) too. Once
// fullscreen, CoursePreviewViewer's existing useStageScale picks up the
// extra height on its next ResizeObserver tick and grows the canvas to
// match on its own — no extra plumbing needed here beyond the toggle
// itself and tracking whether we're currently fullscreen (for the
// icon/label, and so a browser-native Escape-to-exit is reflected too,
// not just clicks on this button).
export function FullscreenToggle() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function handleChange() {
      setIsFullscreen(document.fullscreenElement != null);
    }
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  function toggle() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      onClick={toggle}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      className="shrink-0"
    >
      {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
    </Button>
  );
}
