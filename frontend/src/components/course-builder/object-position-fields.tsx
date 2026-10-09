"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CANVAS_H, CANVAS_W } from "./slide-canvas";

// Shared by text-object-properties.tsx and image-object-properties.tsx —
// both need the same four-number "position pixel-perfectly" inputs, they
// just differ in what (xPct, yPct) MEANS for their object (top-left corner
// for a text box, center point for an image — see each caller's own
// comment) and in whether X/Y even apply at all (the side-by-side
// image-left/right layout's picture has no position, only a size — see
// ImageObjectProperties). The px<->% conversion itself is identical either
// way: this app's canvas is a fixed, non-zoomed 960x540 box (CANVAS_W/
// CANVAS_H — see slide-canvas.tsx), so a plain `/CANVAS_W*100` or
// `*CANVAS_W/100` is always correct with no extra scale factor to account
// for, regardless of which point the percentage anchors.
export function ObjectPositionFields({
  xLabel = "X",
  yLabel = "Y",
  xPct,
  yPct,
  widthPct,
  heightPct,
  onChange,
}: {
  xLabel?: string;
  yLabel?: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  onChange: (next: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
}) {
  function commit(field: "x" | "y" | "w" | "h", px: number) {
    const dim = field === "x" || field === "w" ? CANVAS_W : CANVAS_H;
    const nextPct = (px / dim) * 100;
    onChange({
      xPct: field === "x" ? nextPct : xPct,
      yPct: field === "y" ? nextPct : yPct,
      widthPct: field === "w" ? nextPct : widthPct,
      heightPct: field === "h" ? nextPct : heightPct,
    });
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <PixelField label={xLabel} pct={xPct} canvasDim={CANVAS_W} onCommit={(px) => commit("x", px)} />
      <PixelField label={yLabel} pct={yPct} canvasDim={CANVAS_H} onCommit={(px) => commit("y", px)} />
      <PixelField label="Width" pct={widthPct} canvasDim={CANVAS_W} onCommit={(px) => commit("w", px)} />
      <PixelField label="Height" pct={heightPct} canvasDim={CANVAS_H} onCommit={(px) => commit("h", px)} />
    </div>
  );
}

// One numeric field, displayed and edited in pixels — `pct` is the
// source-of-truth stored value (a percentage of the canvas), converted to
// px only for display/editing here. Local text state, committed on blur or
// Enter (matching this app's established "commit on blur, not per
// keystroke" convention for text fields — see content-slide-face.tsx's
// debounced rich-text commits), not on every keystroke: a half-typed number
// (e.g. "12" while typing "120") would otherwise round-trip through
// `onChange` and immediately move the object mid-keystroke.
//
// Resyncs its local text from `pct` by comparing against a tracked previous
// value during render (this project's sanctioned alternative to
// setState-in-an-effect — see portal-shell.tsx's own use of the same
// pattern) — needed so a canvas drag that changes the real position while
// this field isn't focused is reflected here next time it's shown, rather
// than this field freezing at whatever it last displayed.
function PixelField({
  label,
  pct,
  canvasDim,
  onCommit,
}: {
  label: string;
  pct: number;
  canvasDim: number;
  onCommit: (px: number) => void;
}) {
  const roundedPx = Math.round((pct / 100) * canvasDim);
  const [text, setText] = useState(String(roundedPx));
  const [prevPx, setPrevPx] = useState(roundedPx);
  if (roundedPx !== prevPx) {
    setPrevPx(roundedPx);
    setText(String(roundedPx));
  }

  function commit() {
    const parsed = Number.parseInt(text, 10);
    if (Number.isFinite(parsed)) {
      onCommit(parsed);
    } else {
      setText(String(roundedPx));
    }
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8"
      />
    </div>
  );
}
