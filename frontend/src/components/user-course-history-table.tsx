"use client";

import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CourseAttempt } from "@/lib/attempt-types";
import { cn } from "@/lib/utils";

// The user detail page's cross-course history — same table-fixed/expandable
// design as course-analytics-table.tsx, just grouped by COURSE instead of
// by user, since this page already knows which user it's showing (that
// axis is implicit here, the way the analytics table's own page already
// knows which course it's showing).
export type CourseSummary = {
  courseId: string;
  courseName: string;
  attemptCount: number;
  bestScore: number | null;
  passed: boolean | null;
  lastAttemptAt: string;
  // Still archived, not yet permanently deleted — history stays visible
  // here either way, this just labels it. A permanently deleted course
  // never reaches this table at all (its attempts are purged along with
  // it), so there's no equivalent "deleted" state to render.
  isArchived: boolean;
  // Tells apart the one remaining reason `passed` (on the summary, or on
  // any individual attempt below) can be null: a non-assessment course
  // never has a pass/fail concept at all (grading.py only ever sets
  // `passed` when course.is_assessment). An assessment attempt reports
  // binary pass/fail only — see PassedBadge's own comment on why an
  // in-progress/abandoned attempt reads as "Failed" rather than a third,
  // open-ended state.
  isAssessment: boolean;
};

// An assessment attempt is always either Passed or Failed here, never
// "In progress" — reported directly: a course left mid-way (closed the
// tab, never came back) stuck its attempt in in_progress forever, and
// surfacing that as a vague, perpetually-unresolved "In progress" read as
// broken rather than simply not-yet-passed. `passed === null` on an
// assessment course now only ever means exactly that — not yet
// completed — so it reads as Failed: a real learner who finishes later
// gets their real Passed/Failed the moment they do, and a genuinely
// abandoned attempt stops sitting in limbo. A non-assessment course reads
// N/A instead — not Failed, not even a styled "Not an assessment" —
// reported directly as confusing in its own right: a full-marks score
// sitting next to a Failed-shaped badge read as contradictory, when the
// real answer is simply that pass/fail doesn't apply to an unassessed
// course at all. The score itself (Best score / per-attempt score) is
// completely unaffected — it's computed from CourseAttempt.score, which
// grading.py always sets regardless of is_assessment; only `passed` is
// assessment-gated.
function PassedBadge({ passed, isAssessment }: { passed: boolean | null; isAssessment: boolean }) {
  if (!isAssessment) return <span className="text-muted-foreground">N/A</span>;
  return passed ? <Badge>Passed</Badge> : <Badge variant="destructive">Failed</Badge>;
}

export function UserCourseHistoryTable({
  summaries,
  attemptsByCourse,
}: {
  summaries: CourseSummary[];
  attemptsByCourse: Record<string, CourseAttempt[]>;
}) {
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);

  return (
    <div className="rounded-lg border-2 border-border bg-card shadow-sm">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[28%]">Course</TableHead>
            <TableHead className="w-[13%]">Attempts</TableHead>
            <TableHead className="w-[15%]">Best score</TableHead>
            <TableHead className="w-[15%]">Result</TableHead>
            <TableHead className="w-[19%]">Last attempt</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {summaries.map((summary) => {
            const isOpen = expandedCourseId === summary.courseId;
            // Newest first, oldest last — started_at is an ISO string, so a
            // plain string comparison sorts chronologically.
            const attempts = [...(attemptsByCourse[summary.courseId] ?? [])].sort((a, b) =>
              a.started_at < b.started_at ? 1 : -1,
            );

            return (
              <Fragment key={summary.courseId}>
                <TableRow>
                  <TableCell className="truncate font-medium">
                    {summary.courseName}
                    {summary.isArchived && (
                      <Badge variant="outline" className="ml-2">
                        Archived
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{summary.attemptCount}</TableCell>
                  <TableCell>{summary.bestScore === null ? "—" : `${summary.bestScore}%`}</TableCell>
                  <TableCell>
                    <PassedBadge passed={summary.passed} isAssessment={summary.isAssessment} />
                  </TableCell>
                  <TableCell>{new Date(summary.lastAttemptAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={isOpen ? `Hide ${summary.courseName} attempts` : `Show ${summary.courseName} attempts`}
                      aria-expanded={isOpen}
                      onClick={() => setExpandedCourseId(isOpen ? null : summary.courseId)}
                    >
                      <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                    </Button>
                  </TableCell>
                </TableRow>
                {isOpen &&
                  attempts.map((attempt, index) => (
                    <TableRow
                      key={attempt.id}
                      className={cn("bg-muted hover:bg-muted", index === 0 && "border-t-2 border-t-border")}
                    >
                      <TableCell>
                        {index === 0 && (
                          <span className="text-xs font-semibold text-muted-foreground">Attempt history</span>
                        )}
                      </TableCell>
                      <TableCell />
                      <TableCell>{attempt.score === null ? "—" : `${attempt.score}%`}</TableCell>
                      <TableCell>
                        <PassedBadge passed={attempt.passed} isAssessment={summary.isAssessment} />
                      </TableCell>
                      <TableCell>{new Date(attempt.started_at).toLocaleDateString()}</TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
          {summaries.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                This user hasn&apos;t attempted any courses yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
