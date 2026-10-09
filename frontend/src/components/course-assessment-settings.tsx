"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateCourseAssessmentSettings } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Course } from "@/lib/course-types";

// A course's score/passing-score gate real things (CourseAttempt.passed,
// the portal's "retake reminder" — see role-access.ts and portal/page.tsx)
// so this form only ever writes through the server, never assumes success
// client-side: the checkbox/input reflect local draft state while editing,
// but the actual saved values always come back from the PATCH response.
//
// Deliberately does NOT include the deadline setting (see
// course-deadline-settings.tsx, its own separate card) — a deadline is an
// independent concept, not conditional on this checkbox. A purely
// informative onboarding course with no questions at all can still need a
// "watch this in your first week" deadline; nesting that control inside
// "is this an assessment" made it impossible to express.
export function CourseAssessmentSettings({ course }: { course: Course }) {
  const [isAssessment, setIsAssessment] = useState(course.is_assessment);
  const [passingScore, setPassingScore] = useState(course.passing_score?.toString() ?? "70");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSave() {
    setError(null);
    setSaved(false);
    const score = isAssessment ? Number(passingScore) : null;
    if (isAssessment && (!Number.isFinite(score) || score! < 0 || score! > 100)) {
      setError("Minimum score must be a number between 0 and 100.");
      return;
    }
    startTransition(async () => {
      try {
        await updateCourseAssessmentSettings(course.id, isAssessment, score);
        setSaved(true);
        router.refresh();
      } catch {
        setError("Could not save — please try again.");
      }
    });
  }

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 shadow-sm">
      <div className="font-medium">Assessment</div>
      <p className="mt-1 text-sm text-muted-foreground">
        Mark this course as a scored assessment with a minimum passing score. Operatives who don&apos;t meet it
        are reminded to retake it from their dashboard.
      </p>

      <label className="mt-4 flex items-center gap-2">
        <Checkbox checked={isAssessment} onCheckedChange={(c) => setIsAssessment(c === true)} />
        <span className="text-sm">This course is an assessment</span>
      </label>

      {isAssessment && (
        <div className="mt-3 flex items-center gap-2">
          <Label htmlFor="passing-score" className="text-sm text-muted-foreground">
            Minimum score to pass (%)
          </Label>
          <Input
            id="passing-score"
            type="number"
            min={0}
            max={100}
            value={passingScore}
            onChange={(e) => setPassingScore(e.target.value)}
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
