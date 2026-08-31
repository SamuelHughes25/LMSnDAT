"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import type { Editor } from "@tiptap/react";

// Up to two EditableBody/TipTap instances can be mounted at once (the
// two-column content layout renders `body` and `body2` as fully independent
// editors — see content-slide-face.tsx). The formatting toolbar needs to
// know which one (if either) currently has focus, so it applies commands to
// the right document. This context is that single source of truth, provided
// once at the top of the builder (course-builder.tsx) so both the toolbar
// and every EditableBody instance can reach it without prop-drilling through
// the slide-face component tree.
type ActiveEditorContextValue = {
  activeEditor: Editor | null;
  // Typed as the raw `useState` dispatch (not just `(e: Editor | null) =>
  // void`) so callers can use the functional-updater form. That's not just
  // a nicety — it's what makes the blur handler race-safe (see the comment
  // on `setActiveEditor` in the provider below).
  setActiveEditor: Dispatch<SetStateAction<Editor | null>>;
  // Whether the active editor's current selection is non-empty — the signal
  // the toolbar uses to decide whether to render at all ("pop up when text
  // is highlighted"). Scoped to the ActiveEditorProvider (not local state
  // inside the toolbar) so course-builder.tsx can react to it too, e.g. to
  // conditionally mount the toolbar row itself rather than only toggling its
  // internal contents.
  hasSelection: boolean;
  // The current selection's on-screen bounding box (native Selection API,
  // not TipTap's coordsAtPos — simpler, and already correct by the time
  // `selectionUpdate` fires, since that only fires after ProseMirror has
  // synced its selection to the DOM). `null` whenever there's no active
  // editor, no selection, or the browser's Selection API couldn't produce
  // a usable rect (see the guarded computation in the provider below).
  // SlideTextToolbar uses this to float itself near the selection
  // (`position: fixed`) instead of at a fixed spot on the page.
  selectionRect: DOMRect | null;
  // The toolbar's own root DOM node, so an editor's onBlur handler can tell
  // "focus moved into the toolbar itself" (e.g. clicking a plain button)
  // apart from "focus moved somewhere else entirely" — see the comment on
  // RichTextBody's onBlur in content-slide-face.tsx.
  toolbarRef: RefObject<HTMLDivElement | null>;
  // Explicit "a toolbar control that manages its own focus is currently
  // open/interacting" flag — set by the font-size Select (see
  // slide-text-toolbar.tsx). Exists because that control's popover content
  // renders in a portal outside toolbarRef's DOM subtree, so plain DOM
  // containment can't detect it; a ref (not state) because it only needs to
  // be read synchronously inside an editor's onBlur handler, never to drive
  // a render itself.
  toolbarInteractingRef: RefObject<boolean>;
};

const ActiveEditorContext = createContext<ActiveEditorContextValue | null>(null);

export function ActiveEditorProvider({ children }: { children: ReactNode }) {
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarInteractingRef = useRef(false);

  // Subscribes to the active editor's selection, re-subscribing every time
  // `activeEditor` changes. Because this effect's cleanup always detaches
  // the *previous* editor's listener before a new one is attached (or
  // before deciding there is no active editor at all), `hasSelection` can
  // never end up reflecting a stale/blurred editor's selection state — there
  // is only ever one subscription alive, tracking whichever editor is
  // current. When there's no active editor, the effect intentionally does
  // nothing (no listener to attach) rather than resetting `hasSelection`
  // itself — that reset is instead *derived* below (`activeEditor !==
  // null && hasSelection`), since "no active editor" trivially implies "no
  // visible selection" without needing an effect to say so. Same reasoning
  // applies to `selectionRect`.
  useEffect(() => {
    if (!activeEditor) return;
    const updateSelection = () => {
      const empty = activeEditor.state.selection.empty;
      setHasSelection(!empty);
      if (empty) {
        setSelectionRect(null);
        return;
      }
      // Native Selection API, not TipTap's coordsAtPos — simpler, and the
      // native selection is already correct here since selectionUpdate
      // fires after ProseMirror has synced its selection to the DOM.
      // getRangeAt(0) throws if rangeCount is 0 even when `sel` itself is
      // non-null, so that's checked explicitly; the try/catch is
      // belt-and-suspenders for any other browser-specific edge case.
      try {
        const domSelection = window.getSelection();
        if (!domSelection || domSelection.rangeCount === 0) {
          setSelectionRect(null);
          return;
        }
        const rect = domSelection.getRangeAt(0).getBoundingClientRect();
        // A zero-size rect (e.g. a selection that collapses onto an empty
        // inline node) isn't useful to anchor the toolbar to.
        setSelectionRect(rect.width > 0 || rect.height > 0 ? rect : null);
      } catch {
        setSelectionRect(null);
      }
    };
    updateSelection();
    activeEditor.on("selectionUpdate", updateSelection);
    return () => {
      activeEditor.off("selectionUpdate", updateSelection);
    };
  }, [activeEditor]);

  const value = useMemo(
    () => ({
      activeEditor,
      setActiveEditor,
      hasSelection: activeEditor !== null && hasSelection,
      selectionRect: activeEditor !== null ? selectionRect : null,
      toolbarRef,
      toolbarInteractingRef,
    }),
    [activeEditor, hasSelection, selectionRect],
  );

  return <ActiveEditorContext.Provider value={value}>{children}</ActiveEditorContext.Provider>;
}

// Each EditableBody instance calls this on focus/blur (via TipTap's
// onFocus/onBlur editor options) to register/unregister itself.
//
// The blur side is the part worth tracing through carefully (this is the
// highest-risk piece of this change): when focus moves from editor A
// straight to editor B — e.g. clicking from the left column into the right
// column in the two-column layout — the browser fires A's blur before B's
// focus. If A's blur handler unconditionally cleared the context
// (`setActiveEditor(null)`), that's still technically fine *if* blur always
// strictly precedes focus... but relying on that ordering is exactly the
// kind of assumption that quietly breaks later (a future toolbar-mousedown
// path, a browser quirk, React batching two updates together). So instead,
// every EditableBody calls `setActiveEditor` with the *functional* updater
// form: `setActiveEditor((current) => (current === thisEditor ? null :
// current))`. React guarantees a functional updater always runs against the
// true latest state at the moment it's applied — never a value captured in
// a stale closure — so even if B's focus handler somehow ran first and set
// the context to B, A's later blur-clear sees `current === B !== A` and
// leaves it alone. There's no ordering assumption left to break.
export function useActiveEditorContext() {
  const ctx = useContext(ActiveEditorContext);
  if (!ctx) {
    throw new Error("useActiveEditorContext must be used within an ActiveEditorProvider");
  }
  return ctx;
}
