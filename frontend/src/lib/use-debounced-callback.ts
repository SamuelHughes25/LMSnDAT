import { useEffect, useMemo, useRef } from "react";

// Small dependency-free debounce hook: returns a stable function that delays
// invoking `callback` until `delayMs` has passed with no further calls.
//
// The returned function also carries a `.flush()` method — call it to force
// whatever call is CURRENTLY pending to run immediately (and synchronously),
// cancelling the timer. Every editor field in this app (RichTextFreeTextBox,
// RichTextBody, WidgetEditableText, etc.) calls this on blur specifically:
// without it, moving focus away from a field right after an edit — clicking
// a Layers panel reorder button, another box, anywhere — left that edit
// sitting in an un-fired timer with no guarantee anything would ever flush
// it before some OTHER action (reading the parent's own "current config"
// ref to merge its own, unrelated patch on top of) ran first and captured a
// config snapshot that didn't include it yet. Confirmed as the likely cause
// of a real, reported bug: formatting (bold/underline) applied to a text
// box, then reordering that box's layer moments later, silently reverted
// the box's content to an earlier, unformatted version — classic "the
// pending autosave never got a chance to land before something else read
// stale state" symptom. Flushing on blur closes that window structurally,
// rather than hoping the debounce always wins the race.
//
// On UNMOUNT, any STILL-pending call is also flushed (not silently
// discarded) — e.g. switching slides mid-debounce used to drop the last few
// hundred milliseconds of a user's edit on the floor with no warning.
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
) {
  const callbackRef = useRef(callback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgsRef = useRef<Args | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  function flushPending() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (pendingArgsRef.current) {
      const pending = pendingArgsRef.current;
      pendingArgsRef.current = null;
      callbackRef.current(...pending);
    }
  }

  useEffect(() => {
    return () => {
      flushPending();
    };
    // Deliberately mount-only — flushPending only ever reads through refs
    // (always current regardless of which render's closure this is), so
    // there's nothing to re-subscribe to.
  }, []);

  // Built with useMemo (not useCallback + a mutation afterward) specifically
  // so the `.flush` property is attached to a plain object THIS hook just
  // created, not one "borrowed" from another hook call — the lint config's
  // react-hooks/immutability rule (correctly) flags mutating a value a hook
  // handed back to you, which attaching .flush onto a useCallback result
  // would be.
  return useMemo(() => {
    const debounced = (...args: Args) => {
      pendingArgsRef.current = args;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        const pending = pendingArgsRef.current;
        pendingArgsRef.current = null;
        if (pending) callbackRef.current(...pending);
      }, delayMs);
    };
    debounced.flush = flushPending;
    return debounced;
  }, [delayMs]);
}
