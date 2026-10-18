"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { Editor } from "@tiptap/react";

// Up to two EditableBody/TipTap instances can be mounted at once (the
// two-column content layout renders `body` and `body2` as fully independent
// editors — see content-slide-face.tsx). The properties panel needs to know
// which one (if either) currently has focus AND which field/box owns it, so
// it can apply commands to the right document and — critically — refuse to
// act on a stale editor left over from a box the user is no longer looking
// at (see activeEditorId below). Provided once at the top of the builder
// (course-builder.tsx) so both the panel and every EditableBody instance can
// reach it without prop-drilling through the slide-face component tree.
//
// Previously also tracked `hasSelection`/`selectionRect`, which existed
// solely to let a floating toolbar (slide-text-toolbar.tsx, since removed)
// pop up near a text highlight and know whether to render at all. The
// properties panel doesn't float near anything — it's a fixed region that
// shows an object's controls whenever that object is SELECTED (see
// slide-selection-context.tsx), independent of whether any text is
// currently highlighted — so that machinery is gone, not just renamed.
type ActiveEditorContextValue = {
  activeEditor: Editor | null;
  // Which box owns `activeEditor` — namespaced the same way
  // slide-selection-context.tsx's `selectedId` is (`${slideId}:${field}`).
  // The properties panel compares this against the currently SELECTED
  // object's own id before trusting `activeEditor` for a formatting command:
  // a box can be selected (via slide-selection-context) without its editor
  // ever having taken focus — e.g. selected by grabbing its move band rather
  // than clicking into its text — in which case `activeEditor` may be null,
  // or may still point at whatever OTHER box was last actually focused.
  // Without this check, a formatting command issued from the panel could
  // silently apply to the wrong box's text.
  activeEditorId: string | null;
  // Registers `editor` as active under `id`, called on that editor's own
  // onFocus. A plain setter (not exposed as raw dispatch) since focus and
  // blur are the only two ways this ever changes, and pairing them under
  // one function keeps `activeEditor`/`activeEditorId` from ever updating
  // independently of each other.
  focusEditor: (id: string, editor: Editor) => void;
  // Clears the active editor, but ONLY if `editor` is still the one
  // currently registered — the same functional-updater race-safety this
  // context has always used (see the comment on `blurEditor`'s
  // implementation below), now just wrapped in a named function instead of
  // exposing the raw dispatch for callers to get right themselves.
  blurEditor: (id: string, editor: Editor) => void;
  // The properties panel's own root DOM node, so an editor's onBlur handler
  // (and slide-selection-context's own deselect-on-blur/deselect-on-outside-
  // click checks) can tell "focus moved into the panel itself" (e.g.
  // clicking a plain button, or a numeric position input) apart from "focus
  // moved somewhere else entirely."
  panelRef: RefObject<HTMLDivElement | null>;
  // Explicit "a panel control that manages its own focus is currently
  // open/interacting" flag — set by any portal-rendered control in the
  // panel (a Select's listbox, a DropdownMenu's items). Exists because such
  // content renders in a portal outside panelRef's DOM subtree, so plain DOM
  // containment can't detect it; a ref (not state) because it only needs to
  // be read synchronously inside a blur/outside-click handler, never to
  // drive a render itself.
  panelInteractingRef: RefObject<boolean>;
  // True iff the most recent pointerdown anywhere on the page landed inside
  // panelRef's own DOM subtree — kept fresh by a single document-level
  // capture-phase listener below, read synchronously by every editor's
  // onBlur guard (positionable-box.tsx, content-slide-face.tsx,
  // free-text-box.tsx) alongside focusMovedIntoPanel/panelInteractingRef.
  // Exists because `e.relatedTarget` (what focusMovedIntoPanel checks) is
  // only ever non-null when the click landed on something natively
  // FOCUSABLE — a plain click on a <label>/<div>/heading/whitespace inside
  // the panel (e.g. the "X"/"Y" position-field labels, which have no
  // for/id pairing to their <input>) never moves real DOM focus anywhere,
  // so relatedTarget is null and the existing guard wrongly concludes focus
  // left the panel entirely, firing a deselect mid-interaction. Confirmed
  // via a real browser to be the actual mechanism behind a reported "can't
  // click around in the side panel without the box losing its highlight
  // and the panel jumping back to the generic slide view" bug — pointerdown
  // fires (and this ref updates) strictly before the resulting blur, so by
  // the time any onBlur handler runs, it already reflects where the CLICK
  // actually started, regardless of whether that landed on something
  // focusable.
  panelPointerDownRef: RefObject<boolean>;
  // Whatever font-family value (TipTap's own CSS value string, e.g.
  // `"Georgia, 'Times New Roman', serif"`, or null for "no override) the
  // author most recently picked from ANY text field's Font dropdown in
  // THIS course-builder session — reported directly as a real workflow
  // annoyance: re-selecting the same font over and over for every new
  // text box in one course. A ref, not state: it's only ever read once,
  // at a fresh editor's own creation time (see free-text-box.tsx/
  // content-slide-face.tsx), never something that should trigger a
  // re-render when it changes. Lives here (not localStorage or the
  // database) specifically because the request was "remembered during
  // their session" — resets naturally on a fresh page load/different
  // course, same lifetime as this whole provider.
  lastFontFamilyRef: RefObject<string | null>;
};

const ActiveEditorContext = createContext<ActiveEditorContextValue | null>(null);

export function ActiveEditorProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ id: string; editor: Editor } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelInteractingRef = useRef(false);
  const panelPointerDownRef = useRef(false);
  const lastFontFamilyRef = useRef<string | null>(null);

  // Capture phase, document-wide: this is the one thing that reliably runs
  // BEFORE the blur a pointerdown is about to cause, for every single click
  // anywhere on the page, focusable target or not — see
  // panelPointerDownRef's own comment on the type above for why that's
  // exactly what the existing relatedTarget-based checks can't provide.
  useEffect(() => {
    function handlePointerDownCapture(e: PointerEvent) {
      panelPointerDownRef.current = !!(
        panelRef.current &&
        e.target instanceof Node &&
        panelRef.current.contains(e.target)
      );
    }
    document.addEventListener("pointerdown", handlePointerDownCapture, true);
    return () => document.removeEventListener("pointerdown", handlePointerDownCapture, true);
  }, []);

  const value = useMemo<ActiveEditorContextValue>(
    () => ({
      activeEditor: active?.editor ?? null,
      activeEditorId: active?.id ?? null,
      focusEditor: (id, editor) => setActive({ id, editor }),
      // Functional-updater form — see the type's own comment on `blurEditor`
      // for why: if focus moves from editor A straight to editor B, the
      // browser fires A's blur before B's focus, so A's blur handler must
      // never unconditionally clear the context — only if IT is still the
      // one registered. Reading `current` fresh at apply-time (rather than
      // whatever this closure captured) is what makes that safe regardless
      // of ordering.
      blurEditor: (id, editor) =>
        setActive((current) => (current?.editor === editor ? null : current)),
      panelRef,
      panelInteractingRef,
      panelPointerDownRef,
      lastFontFamilyRef,
    }),
    [active],
  );

  return <ActiveEditorContext.Provider value={value}>{children}</ActiveEditorContext.Provider>;
}

export function useActiveEditorContext() {
  const ctx = useContext(ActiveEditorContext);
  if (!ctx) {
    throw new Error("useActiveEditorContext must be used within an ActiveEditorProvider");
  }
  return ctx;
}

// Forces a re-render on every transaction of whichever editor a properties
// panel is currently showing TextFormattingControls for (content change,
// cursor move, mark toggle) — without this, the panel's own "current bold/
// color/font" display goes stale the instant a mark is applied to an
// already-selected range, since that doesn't move the selection itself (the
// only thing React already re-renders on here). Shared by every panel that
// renders TextFormattingControls against `activeEditor` — text-object-
// properties.tsx, free-text-box-properties.tsx, and properties-panel.tsx's
// own widget-text branch — rather than each re-implementing the same
// editor.on("transaction", ...)/forceUpdate pair.
export function useForceRerenderOnEditorTransaction(editor: Editor | null) {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!editor) return;
    function handleTransaction() {
      forceUpdate((v) => v + 1);
    }
    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor]);
}
