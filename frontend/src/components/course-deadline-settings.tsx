"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateCourseDeadlineDays } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Course } from "@/lib/course-types";

// Fully independent of CourseAssessmentSettings (its own separate card,
// its own server action) — a deadline is not conditional on the course
// being a scored assessment. A purely informative onboarding course with
// no questions at all can still need a "watch this within N days of being
// assigned" deadline; a non-assessment course's "done" state for this
// purpose is just having any completed attempt at all (see the
// Dashboard's own overdue widget and portal/page.tsx's reminders, both of
// which check completion instead of a pass/fail score when is_assessment
// is false).
//
// A number of DAYS, not a fixed calendar date — this course's real due
// date is now per-person, counted from whenever each learner personally
// became eligible for it (direct assignment, a Group they're in that has
// it, or vice versa — see CourseAccessGrant on the backend), not one
// shared date for everyone. Reported directly as the old single-date
// field's real flaw: someone assigned the course six months after
// everyone else still got the exact same deadline as them, despite
// having a much shorter real window to act in.
export function CourseDeadlineSettings({ course }: { course: Course }) {
  const [hasDeadline, setHasDeadline] = useState(course.deadline_days !== null);
  const [days, setDays] = useState(course.deadline_days?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSave() {
    setError(null);
    setSaved(false);
    const parsed = Number(days);
    if (hasDeadline && (!days || !Number.isInteger(parsed) || parsed < 1)) {
      setError("Enter a whole number of days (at least 1), or untick the checkbox.");
      return;
    }
    startTransition(async () => {
      try {
        await updateCourseDeadlineDays(course.id, hasDeadline ? parsed : null);
        setSaved(true);
        router.refresh();
      } catch {
        setError("Could not save — please try again.");
      }
    });
  }

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 shadow-sm">
      <div className="font-medium">Deadline</div>
      <p className="mt-1 text-sm text-muted-foreground">
        Give this course an allotted time to complete — works whether or not it&apos;s a scored assessment
        (e.g. an onboarding video everyone just needs to watch soon after being assigned it). Counted
        individually from when each operative is actually assigned the course, not one shared date for
        everyone. Operatives who miss their own due date show up on the admin/manager dashboard.
      </p>

      <label className="mt-4 flex items-center gap-2">
        <Checkbox checked={hasDeadline} onCheckedChange={(c) => setHasDeadline(c === true)} />
        <span className="text-sm">This course has a deadline</span>
      </label>

      {hasDeadline && (
        <div className="mt-3 flex items-center gap-2">
          <Label htmlFor="deadline-days" className="text-sm text-muted-foreground">
            Days to complete, from assignment
          </Label>
          <Input
            id="deadline-days"
            type="number"
            min={1}
            step={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="w-24"
          />
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved && !pending && <span className="text-sm text-muted-foreground">Saved.</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}
