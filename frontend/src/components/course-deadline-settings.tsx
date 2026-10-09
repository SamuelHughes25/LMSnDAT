"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateCourseDeadline } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Course } from "@/lib/course-types";

// Fully independent of CourseAssessmentSettings (its own separate card,
// its own server action) — a deadline is not conditional on the course
// being a scored assessment. A purely informative onboarding course with
// no questions at all can still need a "watch this in your first week"
// deadline; a non-assessment course's "done" state for this purpose is
// just having any completed attempt at all (see the Dashboard's own
// overdue widget and portal/page.tsx's reminders, both of which check
// completion instead of a pass/fail score when is_assessment is false).
export function CourseDeadlineSettings({ course }: { course: Course }) {
  const [hasDeadline, setHasDeadline] = useState(course.deadline !== null);
  const [deadline, setDeadline] = useState(course.deadline ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSave() {
    setError(null);
    setSaved(false);
    if (hasDeadline && !deadline) {
      setError("Pick a deadline date, or untick the checkbox.");
      return;
    }
    startTransition(async () => {
      try {
        await updateCourseDeadline(course.id, hasDeadline ? deadline : null);
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
        Give this course a due date — works whether or not it&apos;s a scored assessment (e.g. an onboarding
        video everyone just needs to watch in their first week). Operatives who miss it show up on the
        admin/manager dashboard.
      </p>

      <label className="mt-4 flex items-center gap-2">
        <Checkbox checked={hasDeadline} onCheckedChange={(c) => setHasDeadline(c === true)} />
        <span className="text-sm">This course has a deadline</span>
      </label>

      {hasDeadline && (
        <div className="mt-3 flex items-center gap-2">
          <Label htmlFor="deadline" className="text-sm text-muted-foreground">
            Due date
          </Label>
          <Input
            id="deadline"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-44"
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
