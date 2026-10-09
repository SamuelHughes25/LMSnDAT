// Thin, isolated wrapper around TipTap's own FontFamily extension — same
// shape and same reasoning as tiptap-font-size.ts's FontSize re-export.
//
// @tiptap/extension-text-style (v3.30.5, the version installed here) ships
// an official `FontFamily` extension alongside `TextStyle`/`FontSize`/
// `Color` — it registers a `fontFamily` attribute on the same `textStyle`
// mark those already use, and exposes exactly the `setFontFamily(name)` /
// `unsetFontFamily()` command pair the properties panel needs. No new
// dependency to install: `FontFamily` is already exported from the exact
// package this app already depends on. Re-exported from its own file, not
// imported directly in content-slide-face.tsx/text-object-properties.tsx,
// so the font-family implementation stays a single swappable seam, same as
// tiptap-font-size.ts/tiptap-text-color.ts.
export { FontFamily } from "@tiptap/extension-text-style";
