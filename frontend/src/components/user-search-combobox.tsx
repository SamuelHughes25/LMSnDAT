"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type UserOption = { id: number; username: string };

// A type-to-filter picker over an already-fetched candidate list (no
// server round-trip — every caller so far already has the full candidate
// array in hand, e.g. content-ownership-card.tsx's editor/owner lists) —
// replaces a Select-based picker that got reported as "can only add one
// editor" once the candidate list grows large enough that scrolling a
// dropdown of every user in the system stops being usable. Picking a
// suggestion calls onSelect and clears the query, ready to search again
// immediately — the caller decides what "selected" means (add an editor,
// stage a transfer-ownership confirmation, etc.), this component only
// ever surfaces the pick.
export function UserSearchCombobox({
  candidates,
  placeholder,
  onSelect,
  disabled,
  className,
}: {
  candidates: UserOption[];
  placeholder: string;
  onSelect: (user: UserOption) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const trimmed = query.trim().toLowerCase();
  const matches = trimmed ? candidates.filter((u) => u.username.toLowerCase().includes(trimmed)) : candidates;

  function pick(user: UserOption) {
    onSelect(user);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // A plain blur-closes-immediately would fire BEFORE a click on
          // an option below gets a chance to register, swallowing every
          // pick — deferring it lets that option's own onMouseDown (which
          // preventDefaults the blur-causing mousedown, see below) commit
          // first.
          setTimeout(() => setOpen(false), 100);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        disabled={disabled}
      />
      {open && !disabled && matches.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
          {matches.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => {
                // Prevents the Input's onBlur from closing the dropdown
                // before this click is processed as a real click.
                e.preventDefault();
                pick(u);
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              {u.username}
            </button>
          ))}
        </div>
      )}
      {open && !disabled && trimmed && matches.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border bg-popover p-2 text-sm text-muted-foreground shadow-md">
          No matching users.
        </div>
      )}
    </div>
  );
}
