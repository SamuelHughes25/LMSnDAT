// Thin, isolated wrapper around TipTap's own Color extension — same shape
// and same reasoning as tiptap-font-size.ts's FontSize re-export.
//
// @tiptap/extension-text-style (v3.30.5, the version installed here) ships
// an official `Color` extension alongside `TextStyle`/`FontSize` — it
// registers a `color` attribute on the same `textStyle` mark FontSize
// already uses, and exposes exactly the `setColor(color)` / `unsetColor()`
// command pair a toolbar needs. No new dependency to install: `Color` is
// already exported from the exact package this app already depends on for
// `TextStyle`/`FontSize`. Re-exported from its own file, not imported
// directly in content-slide-face.tsx/slide-text-toolbar.tsx, so the
// text-color implementation stays a single swappable seam, same as
// tiptap-font-size.ts.
export { Color } from "@tiptap/extension-text-style";
