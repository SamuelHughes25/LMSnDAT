"use client";

import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { Pipette } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COLOR_PRESETS, type ColorPreset } from "@/lib/color-presets";

// Extracted out of text-formatting-controls.tsx's own TextColorPicker (the
// text-color button's exact dropdown shape: preset swatches + a native
// <input type="color"> custom fallback) so every OTHER color control added
// for the background-color/shape-fill/shape-border/paint-bucket features
// shares one implementation instead of N near-duplicates. TextColorPicker
// itself is now a thin wrapper around this, keeping only its own "A" +
// swatch-bar trigger look.

// EyeDropper is a real, shipped browser API (Chrome/Edge 95+) — sampling a
// color from literally anywhere on screen, images included, with zero
// custom pixel-reading needed. No TypeScript lib.dom type for it yet at
// this app's target, so it's declared minimally here rather than widening
// a global lib config for one API.
declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
  }
}

export function ColorPicker({
  value,
  onChange,
  presets = COLOR_PRESETS,
  allowNone = false,
  noneLabel = "Default",
  panelInteractingRef,
  ariaLabel = "Color",
  triggerClassName,
  renderTrigger,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  presets?: ColorPreset[];
  // Whether a "no color" choice is offered at all — meaningful for some
  // fields (text color's own mark can be unset; a shape's border can be
  // "none") and not others (a shape's fill always renders as SOME color).
  allowNone?: boolean;
  noneLabel?: string;
  // Threaded through to the Base UI DropdownMenu so the properties
  // panel's click-away/deselect logic knows not to fire while this
  // popover is open — same mechanism active-editor-context.tsx's
  // panelInteractingRef already drives for every other panel popover.
  // Every ColorPicker instance MUST pass this, or it reproduces the
  // "deselects mid-interaction" bug class this ref exists to prevent.
  panelInteractingRef: RefObject<boolean>;
  ariaLabel?: string;
  // Applied directly to the trigger <button> itself (forwarded straight
  // through to Base UI's Trigger) — kept separate from renderTrigger's
  // CONTENT so a caller can size/border the button the same way a plain
  // className on it always would, rather than wrapping content in an
  // extra span just to carry layout classes.
  triggerClassName?: string;
  // Each caller's own closed-state look (the "A" + swatch bar for text
  // color, a plain swatch button for background/fill/border) rather than
  // one hardcoded trigger shared by every use.
  renderTrigger: (currentValue: string | null) => React.ReactNode;
}) {
  const [eyedropperSupported, setEyedropperSupported] = useState(false);
  useEffect(() => {
    // Feature-detected in an effect, not read straight in render or via a
    // plain lazy useState initializer — either of those would run during
    // SSR too (where `window` doesn't exist, so the server always bakes
    // in "unsupported") AND during the client's hydration render pass
    // (where it DOES exist), a real hydration mismatch between the
    // server-rendered markup and the client's very first render — not
    // just a theoretical one, since this button's presence/absence is
    // exactly the kind of thing React's hydration check compares.
    // Deferring the update to an effect (which only ever runs after
    // mount, client-side, post-hydration) is what avoids that, at the
    // accepted cost of one extra render the first time any page with
    // this component mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: see comment above, this is the standard hydration-safe "client-only feature" pattern, not an avoidable cascading render.
    setEyedropperSupported(typeof window !== "undefined" && "EyeDropper" in window);
  }, []);

  async function sampleFromScreen() {
    if (!window.EyeDropper) return;
    try {
      const result = await new window.EyeDropper().open();
      onChange(result.sRGBHex);
    } catch {
      // The user cancelled (Escape, or clicked away) — a real, expected
      // AbortError, not a failure worth surfacing.
    }
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        panelInteractingRef.current = open;
      }}
    >
      <DropdownMenuTrigger
        render={<button type="button" />}
        aria-label={ariaLabel}
        title={ariaLabel}
        onMouseDown={(e) => {
          e.preventDefault();
          panelInteractingRef.current = true;
        }}
        className={triggerClassName}
      >
        {renderTrigger(value)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {allowNone && (
          <DropdownMenuItem onClick={() => onChange(null)}>
            <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
            {noneLabel}
          </DropdownMenuItem>
        )}
        {presets.map((preset) => (
          <DropdownMenuItem key={preset.label} onClick={() => onChange(preset.value)}>
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: preset.value }}
            />
            {preset.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm">
          <input
            type="color"
            value={value ?? "#000000"}
            onChange={(e) => onChange(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-5 w-5 shrink-0 cursor-pointer rounded border border-border p-0"
          />
          Custom…
        </label>
        {eyedropperSupported && (
          // A plain button, not a DropdownMenuItem — same precedent as
          // the "Custom…" label/input row above, which also isn't one
          // (a native color input needs to own its own click, same
          // reasoning applies here: this shouldn't inherit the menu's
          // built-in item-click-closes-menu behavior mid-sample).
          <button
            type="button"
            onClick={sampleFromScreen}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Pipette className="h-3.5 w-3.5 shrink-0" />
            Sample from screen…
          </button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
