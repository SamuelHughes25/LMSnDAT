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
};

function PassedBadge({ passed }: { passed: boolean | null }) {
  if (passed === null) return <>—</>;
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
                  <TableCell className="truncate font-medium">{summary.courseName}</TableCell>
                  <TableCell>{summary.attemptCount}</TableCell>
                  <TableCell>{summary.bestScore === null ? "—" : `${summary.bestScore}%`}</TableCell>
                  <TableCell>
                    <PassedBadge passed={summary.passed} />
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
                        <PassedBadge passed={attempt.passed} />
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
