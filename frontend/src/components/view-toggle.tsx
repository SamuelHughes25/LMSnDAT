"use client";

import { LayoutGrid, Rows3 } from "lucide-react";

import type { ViewMode } from "@/lib/use-view-mode";
import { cn } from "@/lib/utils";

// The Compact/Normal switch itself — shared markup for every list page that
// offers the two views (see use-view-mode.ts for the paired state/storage
// hook). A plain styled <button> pair, not the Button component: these need
// a persistent "which one is active" look rather than Button's own
// variant set.
export function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (next: ViewMode) => void }) {
  return (
    <div className="flex justify-end gap-1">
      <ViewToggleButton active={view === "compact"} onClick={() => onChange("compact")} icon={LayoutGrid} label="Compact" />
      <ViewToggleButton active={view === "normal"} onClick={() => onChange("normal")} icon={Rows3} label="Normal" />
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof LayoutGrid;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
