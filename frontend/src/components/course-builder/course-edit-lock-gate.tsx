"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { claimCourseEdit, releaseCourseEdit, type ClaimCourseEditResult } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";

// Comfortably below the backend's own EDIT_LOCK_STALE_SECONDS (60s) — see
// Course.editing_user's comment on the backend for why that margin
// matters: a single slow/dropped heartbeat request should never be enough
// to let the lock expire out from under someone still actively editing.
const HEARTBEAT_INTERVAL_MS = 20_000;

type LockState =
  | { status: "claiming" }
  | { status: "editing" }
  | { status: "conflict"; editingBy: string }
  | { status: "error"; message: string };

// Gates the actual builder behind the hard "someone's already editing
// this course" lock described in Course.editing_user's backend comment —
// claims it on mount, keeps it fresh with a heartbeat while mounted, and
// releases it on unmount. `children` never render until the lock is
// actually held, and there is no override — see claim_edit's own comment
// on the backend for exactly what an "edit anyway" escape hatch used to
// permit (one editor's save silently erasing the other's unrelated
// changes on the same slide) and why it was removed rather than kept as
// a user-facing choice. Deliberately NOT real-time collaborative editing
// either — see that same backend comment for why.
export function CourseEditLockGate({
  courseId,
  courseName,
  children,
}: {
  courseId: string;
  courseName: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<LockState>({ status: "claiming" });
  // Whether THIS mount ever actually came to hold the lock — only release
  // on unmount (or beforeunload) if so. A mount that's still stuck on
  // "claiming" or bailed out on a conflict never held anything, and
  // releasing in that case would risk clearing whatever the REAL holder
  // currently has.
  const heldRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startHeartbeat() {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      claimCourseEdit(courseId).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
  }

  function applyResult(result: ClaimCourseEditResult) {
    if (result.ok) {
      heldRef.current = true;
      setState({ status: "editing" });
      startHeartbeat();
    } else if (result.conflict) {
      setState({ status: "conflict", editingBy: result.editingBy });
    } else {
      setState({ status: "error", message: result.error });
    }
  }

  useEffect(() => {
    let cancelled = false;
    claimCourseEdit(courseId).then((result) => {
      if (!cancelled) applyResult(result);
    });

    // Best-effort only — releaseCourseEdit is a Server Action (a real
    // request through Next's own handling, not something sendBeacon can
    // fire), so there's no guarantee this completes before a closing tab
    // actually goes away. That's fine: EDIT_LOCK_STALE_SECONDS on the
    // backend is the real safety net for exactly that case, this is just
    // the fast path for an ordinary "navigate back/close the tab" exit.
    function handleBeforeUnload() {
      if (heldRef.current) releaseCourseEdit(courseId);
    }
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (heldRef.current) releaseCourseEdit(courseId);
    };
    // Deliberately mount-once — re-running this per courseId change is
    // moot anyway (the builder's own page remounts entirely on a
    // different course, a different URL param), and applyResult/
    // startHeartbeat are plain functions redefined every render, not
    // values this effect should re-subscribe to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  if (state.status === "claiming") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        Checking course availability…
      </div>
    );
  }

  if (state.status === "conflict") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <TriangleAlert className="h-8 w-8 text-amber-500" />
        <div className="max-w-md space-y-1.5">
          <p className="text-lg font-semibold">
            {state.editingBy} is currently editing &ldquo;{courseName}&rdquo;
          </p>
          <p className="text-sm text-muted-foreground">
            Only one person can be in the builder for a course at a time, to stop one editor&apos;s save from
            silently overwriting the other&apos;s. Wait for them to finish and try again.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href={`/courses/${courseId}`} />}>
            Go back
          </Button>
          <Button
            onClick={() => {
              setState({ status: "claiming" });
              claimCourseEdit(courseId).then(applyResult);
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-destructive">{state.message}</div>;
  }

  return <>{children}</>;
}
