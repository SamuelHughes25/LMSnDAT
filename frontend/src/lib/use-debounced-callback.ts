import { useCallback, useEffect, useRef } from "react";

// Small dependency-free debounce hook: returns a stable function that delays
// invoking `callback` until `delayMs` has passed with no further calls, and
// cancels any pending timeout on unmount (or when this hook re-renders with
// a new `callback`/`delayMs`, e.g. after switching the selected slide) so a
// stale PATCH from a previous selection never fires.
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
) {
  const callbackRef = useRef(callback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return useCallback(
    (...args: Args) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        callbackRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}
