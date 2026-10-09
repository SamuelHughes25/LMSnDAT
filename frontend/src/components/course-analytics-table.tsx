"use client";

import { Fragment, useState, useTransition } from "react";
import { ChevronDown, Pencil } from "lucide-react";

import { removeDeadlineExtension, setDeadlineExtension } from "@/app/actions/deadlines";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AccountUser } from "@/lib/accounts-types";
import type { CourseAttempt } from "@/lib/attempt-types";
import { cn } from "@/lib/utils";

// Grouped-by-user summary row, aggregated in the server component (see
// analytics/page.tsx) from the raw attempt list.
export type UserSummary = {
  userId: number;
  attemptCount: number;
  bestScore: number | null;
  passed: boolean | null;
  lastAttemptAt: string;
};

function PassedBadge({ passed }: { passed: boolean | null }) {
  if (passed === null) return <>—</>;
  return passed ? <Badge>Passed</Badge> : <Badge variant="destructive">Failed</Badge>;
}

// One user's effective deadline for this course (their own extension if
// they have one, else the course's own default — see
// Course.effective_deadline_for() in backend/apps/courses/models.py) plus
// a small inline editor for granting/changing that extension. Surfaced
// here, in the same table an admin/manager is already looking at this
// course's users through, rather than a separate page — this is where
// they'd realistically notice someone needs more time.
function DeadlineCell({ courseId, userId, effectiveDeadline }: { courseId: string; userId: number; effectiveDeadline: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(effectiveDeadline ?? "");
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <span>{effectiveDeadline ? new Date(effectiveDeadline).toLocaleDateString() : "—"}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit deadline for user ${userId}`}
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        className="h-7 w-36 text-xs"
      />
      <Button
        size="sm"
        disabled={pending || !value}
        onClick={() =>
          startTransition(async () => {
            await setDeadlineExtension(courseId, userId, value);
            setEditing(false);
          })
        }
      >
        Save
      </Button>
      {effectiveDeadline && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await removeDeadlineExtension(courseId, userId);
              setEditing(false);
            })
          }
        >
          Clear
        </Button>
      )}
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </div>
  );
}

// "use client" only for the two genuinely interactive things here — the
// per-row expand toggle, and the deadline extension editor above. Data
// fetching/aggregation stays in the server component; this just renders it
// and owns which row (if any) is expanded.
export function CourseAnalyticsTable({
  summaries,
  usersById,
  attemptsByUser,
  courseId,
  deadlineByUser,
}: {
  summaries: UserSummary[];
  usersById: Record<number, AccountUser>;
  attemptsByUser: Record<number, CourseAttempt[]>;
  courseId: string;
  // Omitted entirely when the course has no deadline set at all — the
  // Deadline column only ever appears for a course that actually has one
  // to show/edit.
  deadlineByUser?: Record<number, string | null>;
}) {
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const showDeadlineColumn = deadlineByUser !== undefined;
  const columnCount = showDeadlineColumn ? 7 : 6;

  return (
    <div className="rounded-lg border-2 border-border bg-card shadow-sm">
      {/* table-fixed + explicit column widths below — without this, the
          browser's default "auto" table layout recomputes every column's
          width from whichever rows happen to be in the DOM, so expanding a
          row (adding cells with different content/widths, like the blank
          history sub-row cells) visibly shifted every column in the WHOLE
          table, summary rows included. Fixed widths make column widths
          depend only on the header row, never on which rows are expanded. */}
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[24%]">Username</TableHead>
            <TableHead className="w-[10%]">Attempts</TableHead>
            <TableHead className="w-[13%]">Best score</TableHead>
            <TableHead className="w-[13%]">Result</TableHead>
            <TableHead className="w-[16%]">Last attempt</TableHead>
            {showDeadlineColumn && <TableHead className="w-[18%]">Deadline</TableHead>}
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {summaries.map((summary) => {
            const user = usersById[summary.userId];
            const label = user?.username ?? String(summary.userId);
            const isOpen = expandedUserId === summary.userId;
            // Newest first, oldest last — started_at is an ISO string, so
            // a plain string comparison sorts chronologically.
            const attempts = [...(attemptsByUser[summary.userId] ?? [])].sort((a, b) =>
              a.started_at < b.started_at ? 1 : -1,
            );

            return (
              <Fragment key={summary.userId}>
                <TableRow>
                  <TableCell className="truncate font-medium">{label}</TableCell>
                  <TableCell>{summary.attemptCount}</TableCell>
                  <TableCell>{summary.bestScore === null ? "—" : `${summary.bestScore}%`}</TableCell>
                  <TableCell>
                    <PassedBadge passed={summary.passed} />
                  </TableCell>
                  <TableCell>{new Date(summary.lastAttemptAt).toLocaleDateString()}</TableCell>
                  {showDeadlineColumn && (
                    <TableCell>
                      <DeadlineCell
                        courseId={courseId}
                        userId={summary.userId}
                        effectiveDeadline={deadlineByUser[summary.userId] ?? null}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={isOpen ? `Hide ${label}'s attempts` : `Show ${label}'s attempts`}
                      aria-expanded={isOpen}
                      onClick={() => setExpandedUserId(isOpen ? null : summary.userId)}
                    >
                      <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                    </Button>
                  </TableCell>
                </TableRow>
                {/* Sub-rows for each of this user's attempts — still just
                    more rows in the SAME table, reusing the exact same
                    column set as the summary row above (Username/Attempts/
                    chevron blank, since none of those apply to a single
                    attempt) rather than a nested <Table> with its own
                    header. Column-for-column alignment with the table it's
                    drilling into is still the point. A solid (not a faint
                    fractional-opacity tint) bg-muted fill on every row in
                    the block, plus a bolder top border on the first one,
                    is what actually reads as "a clearly separate section"
                    rather than nearly-white rows indistinguishable from the
                    summary row above. "Attempt history" (in the otherwise-
                    blank Username cell of just the first row, not a pill/
                    Badge — a plain small label sits far more naturally
                    inline in a table cell than a badge shape does) names
                    the section without the earlier caption line's verbosity. */}
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
                      {showDeadlineColumn && <TableCell />}
                      <TableCell />
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
          {summaries.length === 0 && (
            <TableRow>
              <TableCell colSpan={columnCount} className="text-center text-muted-foreground">
                No one has attempted this course yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
