import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ComingSoonPanel } from "@/components/course-preview/coming-soon-panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AccountUser, Group } from "@/lib/accounts-types";
import type { CourseAttempt, CourseDeadlineExtension } from "@/lib/attempt-types";
import type { Course, CourseAssignment } from "@/lib/course-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";
import { cn } from "@/lib/utils";

type AttentionReason = "overdue" | "failed";

type AttentionRow = {
  userId: number;
  username: string;
  courseId: string;
  courseName: string;
  reasons: AttentionReason[];
  effectiveDeadline: string | null;
  daysOverdue: number | null;
};

// Everyone, in the caller's own scope (admin: everyone, manager: their own
// team — /users/ already applies that role-scoping server-side, see
// UserViewSet.get_queryset(), so no extra filtering is needed here), who
// needs an admin/manager's attention on a course for one of two reasons:
//
//  - "overdue": past their effective deadline (their own
//    CourseDeadlineExtension if one exists, else the course's own
//    `deadline`) and hasn't "finished" it — for an assessment, a PASSED
//    attempt; for a non-assessment course (no score to check), simply any
//    COMPLETED attempt (see Course.deadline's own comment in
//    backend/apps/courses/models.py for why deadline is independent of
//    is_assessment). Applies to any course with a deadline, scored or not.
//  - "failed": an assessment course they've attempted and NOT passed at
//    least once (a real, non-passing attempt on record), and still haven't
//    passed since. Independent of any deadline — a failed test with no due
//    date is still worth an admin/manager knowing about, previously
//    invisible here entirely unless the course also happened to have a
//    deadline set.
//
// A single (user, course) pair can match both at once (an overdue,
// never-passed assessment) — one merged row, not two, with both reasons
// shown.
async function getAttentionRows(): Promise<AttentionRow[]> {
  const [courses, groups, users] = await Promise.all([
    djangoFetch<Paginated<Course>>("/courses/?page_size=200"),
    djangoFetch<Paginated<Group>>("/groups/?page_size=200"),
    djangoFetch<Paginated<AccountUser>>("/users/?page_size=200"),
  ]);

  const relevantCourses = courses.results.filter((c) => c.deadline !== null || c.is_assessment);
  if (relevantCourses.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const rows: AttentionRow[] = [];

  await Promise.all(
    relevantCourses.map(async (course) => {
      const groupIdsForCourse = new Set(groups.results.filter((g) => g.courses.includes(course.id)).map((g) => g.id));
      const [extensions, attempts, assignments] = await Promise.all([
        course.deadline !== null
          ? djangoFetch<Paginated<CourseDeadlineExtension>>(
              `/course-deadline-extensions/?course=${course.id}&page_size=200`,
            )
          : Promise.resolve<Paginated<CourseDeadlineExtension>>({ count: 0, next: null, previous: null, results: [] }),
        djangoFetch<Paginated<CourseAttempt>>(`/course-attempts/?course=${course.id}&page_size=200`),
        djangoFetch<Paginated<CourseAssignment>>(`/course-assignments/?course=${course.id}&page_size=200`),
      ]);
      // Who can actually see this course — the SAME union role-access.ts's
      // getVisibleCourseIds() relies on (Group membership OR a direct
      // CourseAssignment, freely overlapping). Filtering usersForCourse by
      // Group membership alone silently excluded anyone whose only access
      // was a direct assignment — they'd never appear here as overdue/failed
      // no matter how overdue they actually were.
      const directlyAssignedUserIds = new Set(assignments.results.map((a) => a.user));
      const usersForCourse = users.results.filter(
        (u) => u.content_groups.some((gid) => groupIdsForCourse.has(gid)) || directlyAssignedUserIds.has(u.id),
      );
      if (usersForCourse.length === 0) return;
      const extensionByUser = new Map(extensions.results.map((e) => [e.user, e.extended_deadline]));

      for (const user of usersForCourse) {
        const attemptsForUser = attempts.results.filter((a) => a.user === user.id);
        const hasPassed = course.is_assessment && attemptsForUser.some((a) => a.passed === true);
        const hasFailed = course.is_assessment && !hasPassed && attemptsForUser.some((a) => a.passed === false);

        let daysOverdue: number | null = null;
        let effectiveDeadline: string | null = null;
        let isOverdue = false;
        if (course.deadline !== null) {
          effectiveDeadline = extensionByUser.get(user.id) ?? course.deadline;
          const isFinished = course.is_assessment ? hasPassed : attemptsForUser.some((a) => a.status === "completed");
          if (effectiveDeadline < today && !isFinished) {
            isOverdue = true;
            daysOverdue = Math.floor(
              (new Date(today).getTime() - new Date(effectiveDeadline).getTime()) / (1000 * 60 * 60 * 24),
            );
          }
        }

        const reasons: AttentionReason[] = [];
        if (isOverdue) reasons.push("overdue");
        if (hasFailed) reasons.push("failed");
        if (reasons.length === 0) continue;

        rows.push({
          userId: user.id,
          username: user.username,
          courseId: course.id,
          courseName: course.name,
          reasons,
          effectiveDeadline: isOverdue ? effectiveDeadline : null,
          daysOverdue,
        });
      }
    }),
  );

  // Overdue rows first (sorted by how overdue), then failed-only rows.
  rows.sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1));
  return rows;
}

function ReasonBadge({ reason }: { reason: AttentionReason }) {
  const isOverdue = reason === "overdue";
  return (
    <Badge
      variant={isOverdue ? "destructive" : "secondary"}
      className={cn(!isOverdue && "bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400")}
    >
      {isOverdue ? "Overdue" : "Failed — not retaken"}
    </Badge>
  );
}

export default async function DashboardHomePage() {
  const attentionRows = await getAttentionRows();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-muted-foreground">Pick a section from the sidebar.</p>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <AlertTriangle className="h-3.5 w-3.5" />
          Needs attention
        </div>
        {attentionRows.length > 0 ? (
          <div className="rounded-lg border-2 border-border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Days overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attentionRows.map((row) => (
                  <TableRow key={`${row.userId}-${row.courseId}`}>
                    <TableCell className="font-medium">
                      <Link href={`/users/${row.userId}`} className="hover:underline">
                        {row.username}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/courses/${row.courseId}/analytics`} className="hover:underline">
                        {row.courseName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.reasons.map((reason) => (
                          <ReasonBadge key={reason} reason={reason} />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.effectiveDeadline ? new Date(row.effectiveDeadline).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className={row.daysOverdue !== null ? "text-destructive" : undefined}>
                      {row.daysOverdue ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <ComingSoonPanel
            icon={AlertTriangle}
            title="Nobody needs attention"
            description="Everyone is either on track, already finished, or has passed every assessment they've taken."
          />
        )}
      </div>
    </div>
  );
}
