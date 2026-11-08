import { useCallback, useEffect, useMemo, useRef } from "react";

// One reversible step. `undo`/`redo` are expected to do real work (call a
// setState + a server action, same as the handler that originally made the
// change) — this hook only owns the STACK, never the actual mutation logic,
// so every caller (course-builder.tsx, template-builder.tsx) constructs its
// own entries from whatever handler just ran, using its own domain's
// setters/server actions.
export type HistoryEntry = { undo: () => void; redo: () => void };

const MAX_HISTORY = 50;

// Plain refs, not state — pushing/popping a history entry must never
// trigger a re-render on its own (nothing on screen depends on "how many
// undo steps are available" in this app, at least not yet), and refs also
// mean undo()/redo() always act on the LATEST stack regardless of which
// render's closure called them, with the same "no stale-closure race"
// property useDebouncedCallback's own refs already rely on.
export function useUndoRedo() {
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  // Non-null while a batch is open — see beginBatch's own comment. Entries
  // pushed during a batch are buffered here instead of going straight onto
  // undoStack, then collapsed into ONE combined entry when the batch ends.
  const batchRef = useRef<HistoryEntry[] | null>(null);

  const push = useCallback((entry: HistoryEntry) => {
    redoStack.current = [];
    if (batchRef.current) {
      batchRef.current.push(entry);
      return;
    }
    undoStack.current = [...undoStack.current, entry].slice(-MAX_HISTORY);
  }, []);

  // Collapses every push() made between beginBatch() and endBatch() into a
  // single undo step — needed for a group move (see group-drag-context.tsx):
  // dragging N selected objects together commits N individual onTransform
  // calls, each of which would otherwise push its own entry, making a
  // single Ctrl+Z only undo 1 of the N objects' moves instead of the whole
  // group. endBatch() is a no-op (not an error) when nothing was pushed
  // during the batch, and unwraps a batch of exactly one entry back to that
  // entry directly rather than wrapping it pointlessly.
  const beginBatch = useCallback(() => {
    batchRef.current = [];
  }, []);

  const endBatch = useCallback(() => {
    const entries = batchRef.current;
    batchRef.current = null;
    if (!entries || entries.length === 0) return;
    const combined: HistoryEntry =
      entries.length === 1
        ? entries[0]
        : {
            // Undo in reverse order of how the batch's own actions were
            // applied — the conventional "unwind a stack of changes"
            // order, same reasoning as undoStack itself being LIFO.
            undo: () => {
              for (let i = entries.length - 1; i >= 0; i--) entries[i].undo();
            },
            redo: () => {
              for (const e of entries) e.redo();
            },
          };
    undoStack.current = [...undoStack.current, combined].slice(-MAX_HISTORY);
  }, []);

  const undo = useCallback(() => {
    const stack = undoStack.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    undoStack.current = stack.slice(0, -1);
    entry.undo();
    redoStack.current = [...redoStack.current, entry];
  }, []);

  const redo = useCallback(() => {
    const stack = redoStack.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    redoStack.current = stack.slice(0, -1);
    entry.redo();
    undoStack.current = [...undoStack.current, entry];
  }, []);

  return useMemo(
    () => ({ push, undo, redo, beginBatch, endBatch }),
    [push, undo, redo, beginBatch, endBatch],
  );
}

// Binds Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z or Ctrl+Y (redo) at the
// document level. Deliberately defers entirely — doesn't even
// preventDefault() — while focus is inside a TipTap editor (`.ProseMirror`,
// the class TipTap's own root element always carries): every rich-text
// field in this app already ships StarterKit's bundled History extension,
// which binds this exact same shortcut to that field's OWN local undo
// stack. Intercepting it globally too would fight that field for the same
// keystroke — confirmed from course-builder.tsx's own established pattern
// of letting each subsystem own exactly one concern (e.g. slide-selection-
// context's single shared slot) rather than two mechanisms racing over the
// same signal. A plain <input> (slide/lesson titles) has no such
// conflict — those fields' own history entries are pushed on blur, not
// per-keystroke (see course-builder.tsx's handleLessonTitleChange/
// handleSlideChange title-field wrapping), so the global shortcut is the
// only undo mechanism they ever have.
export function useUndoRedoShortcut(undo: () => void, redo: () => void) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if ((e.target as HTMLElement | null)?.closest(".ProseMirror")) return;
      if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      } else {
        e.preventDefault();
        undo();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);
}
