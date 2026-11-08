"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Click-to-edit/commit-on-blur-or-Enter rename, shared by the manage-
// lessons and manage-slide-templates dialogs (both library lists let an
// author rename an entry in place rather than through a separate dialog).
// Pencil-reveals-on-hover, same shape as slide-layers-panel.tsx's own
// LayerRow — extracted here once a second caller needed the identical
// behavior rather than copied a second time.
export function InlineRenameField({
  value,
  onRename,
  className,
}: {
  value: string;
  onRename: (name: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onRename(trimmed);
    else setDraft(value);
  }

  function startEditing() {
    setDraft(value);
    setEditing(true);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        // Stops a drag-to-reorder handle sitting right next to this field
        // (both dialogs put one there) from ever intercepting a click
        // meant for the input itself.
        onPointerDown={(e) => e.stopPropagation()}
        className={cn("h-7 text-sm", className)}
      />
    );
  }

  return (
    <div className="group/name flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={startEditing}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn("min-w-0 truncate text-left text-sm font-medium", className)}
      >
        {value}
      </button>
      <button
        type="button"
        onClick={startEditing}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={`Rename ${value}`}
        className="shrink-0 text-muted-foreground opacity-0 hover:text-foreground group-hover/name:opacity-100"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}
