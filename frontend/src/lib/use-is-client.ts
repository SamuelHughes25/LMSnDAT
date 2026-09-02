import { useSyncExternalStore } from "react";

// Stable no-op subscribe — there is nothing to subscribe to (the
// client/server distinction never changes after mount), it only needs to
// exist so useSyncExternalStore has a subscribe function with a consistent
// identity across renders.
function subscribeNever() {
  return () => {};
}

// The React-documented way to gate a render to "client only, after
// hydration" without the extra setState-in-effect anti-pattern (and its
// associated lint warning, react-hooks/set-state-in-effect) that the
// equivalent `useState(false) + useEffect(() => setMounted(true), [])`
// pattern produces. The server snapshot is always `false`; the client
// snapshot is always `true` — so the first client render (the one
// hydration reconciles against) still matches the server's `false`, and a
// real client render only happens after.
//
// Originally written locally inside content-slide-face.tsx (for gating
// DOMPurify sanitization, which needs a real `window`/DOM unavailable
// during SSR) and duplicated a second time verbatim while chasing a
// hydration-mismatch bug in the present-mode "shuffle once on mount"
// pattern shared by match-pairs-slide-face.tsx, missing-word-slide-face.tsx,
// and sequencing-slide-face.tsx (Math.random() inside a useState lazy
// initializer runs once on the server and once on the client with
// genuinely different results — confirmed via a real browser to throw
// "Hydration failed because the server rendered text didn't match the
// client"). Two independent needs for the byte-for-byte identical hook (not
// two things that might reasonably drift apart) is what justifies
// extracting it here, unlike this codebase's usual preference for small
// local duplicates when the underlying logic might need to diverge.
export function useIsClient() {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
