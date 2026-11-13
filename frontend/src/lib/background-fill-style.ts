import type { CSSProperties } from "react";

import type { BackgroundFill } from "./course-types";

// Resolves a slide's background_fill (course-types.ts) into inline CSS —
// shared by every place a slide's own root renders (the builder canvas,
// its rail thumbnail, the slide-template manager, and the published
// course preview), so "how background_fill actually paints" is defined
// once rather than four times. Returns `{}` (nothing to override — each
// caller's own `bg-white` class is the correct look) when unset or
// explicitly cleared; an inline style's background-color/background wins
// over that class's own via plain CSS specificity either way, so callers
// never need to also drop the class.
export function backgroundFillStyle(fill: BackgroundFill | null | undefined): CSSProperties {
  if (!fill) return {};
  if (fill.kind === "color") return { backgroundColor: fill.color };
  return { background: `linear-gradient(${fill.angle}deg, ${fill.from}, ${fill.to})` };
}
