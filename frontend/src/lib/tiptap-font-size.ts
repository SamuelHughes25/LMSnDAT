// Thin, isolated wrapper around TipTap's own FontSize extension.
//
// @tiptap/extension-text-style (v3.30.5, the version installed here) ships
// an official `FontSize` extension alongside `TextStyle` — it registers a
// `fontSize` attribute on the `textStyle` mark and exposes exactly the
// `setFontSize(size)` / `unsetFontSize()` command pair a toolbar needs. That
// makes hand-rolling a duplicate Mark unnecessary (and worse: two extensions
// racing to own the same `fontSize` attribute would be a bug, not a
// convenience). Re-exported from its own file — rather than imported
// directly in content-slide-face.tsx/slide-text-toolbar.tsx — so the
// font-size implementation stays a single swappable seam: if a future need
// (e.g. a different unit scheme) requires a custom Mark instead, only this
// file changes.
export { FontSize } from "@tiptap/extension-text-style";
