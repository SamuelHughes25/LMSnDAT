import Link from "next/link";
import { AlertTriangle, BarChart3, Bell, BookOpen, ClipboardList } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ComingSoonPanel } from "@/components/course-preview/coming-soon-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { getCourseReminders, reminderReason } from "@/lib/course-reminders";
import { getCurrentUser } from "@/lib/dal";
import { deadlineStatus } from "@/lib/deadline";
import { djangoFetch } from "@/lib/django";
import { getVisibleCourseIds, getVisibleTemplateIds } from "@/lib/role-access";
import type { Paginated, Template } from "@/lib/types";
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

// Everyone the viewer can actually see (full visibility with Courses/Users
// tab access or above, otherwise just themselves — /users/ already applies
// that scoping server-side, see UserViewSet.get_queryset(), so no extra
// filtering is needed here), who needs attention on a course for one of
// two reasons:
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
//    date is still worth knowing about, previously invisible here entirely
//    unless the course also happened to have a deadline set.
//
// A single (user, course) pair can match both at once (an overdue,
// never-passed assessment) — one merged row, not two, with both reasons
// shown. For a viewer with no broader visibility (an office user granted
// no Courses/Users tab, or — now that this page is reachable by every
// account — an operative), `users` below only ever contains the viewer
// themselves, so this naturally degrades into "do I, personally, need to
// finish anything" rather than ever needing a separate code path.
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

// The office-user Dashboard — unchanged from before this page started
// branching by role, just extracted into its own function. "Office user"
// here means any non-operative account REGARDLESS of its specific
// permission grants — getAttentionRows already self-scopes correctly via
// the backend's own tab/ownership-based query scoping (full visibility
// with Courses/Users tab access, self-only otherwise), so someone with no
// manage permissions at all still gets a safe, sensible, personal-only
// view rather than needing a separate case here. Team-scoped visibility
// (an office user seeing only the operatives THEY manage) is planned but
// not built yet — for now every office user sees the same shape of page.
async function OfficeDashboard() {
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

// The operative Dashboard — unchanged content from the former
// app/portal/page.tsx (ported here verbatim, not redesigned), just
// reached via "/" now instead of "/portal" (which redirects here — see
// that route's own file).
async function OperativeDashboard() {
  const [user, courses, templates, visibleCourseIds, visibleTemplateIds] = await Promise.all([
    getCurrentUser(),
    djangoFetch<Paginated<Course>>("/courses/"),
    djangoFetch<Paginated<Template>>("/templates/"),
    getVisibleCourseIds(),
    getVisibleTemplateIds(),
  ]);

  const reminders = await getCourseReminders(user, courses.results, visibleCourseIds);

  // Same role-scoping as portal/courses/page.tsx and portal/templates/
  // page.tsx (see role-access.ts) — this card's count previously came
  // straight from the unfiltered API response, so a member with no role
  // (or a role missing some content) still saw the TOTAL course/template
  // count here even though the list pages themselves already hid the
  // unassigned ones — reported directly as "the dashboard still says they
  // have a course to view" for a member who couldn't actually see any.
  const courseCount =
    visibleCourseIds === null ? courses.count : courses.results.filter((c) => visibleCourseIds.has(c.id)).length;
  const templateCount =
    visibleTemplateIds === null
      ? templates.count
      : templates.results.filter((t) => visibleTemplateIds.has(t.id)).length;

  const firstName = user.first_name || user.username;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {firstName}</h1>
        <p className="mt-1 text-muted-foreground">Here&apos;s what&apos;s available to you right now.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/portal/courses">
          <Card className="transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                Courses
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{courseCount}</div>
              <p className="text-sm text-muted-foreground">available to take</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/portal/templates">
          <Card className="transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                Templates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{templateCount}</div>
              <p className="text-sm text-muted-foreground">audits to fill out</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Reminders</div>
        {reminders.length > 0 ? (
          <div className="space-y-2">
            {reminders.map((reminder) => {
              const { course } = reminder;
              const deadline = deadlineStatus(course.my_deadline);
              return (
                <Link key={course.id} href={`/portal/courses/${course.id}`}>
                  <div className="flex items-center justify-between rounded-lg border-2 border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40">
                    <div className="flex items-center gap-3">
                      <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{course.name}</div>
                        <p className="text-sm text-muted-foreground">{reminderReason(reminder)}</p>
                        {deadline && (
                          <p className={cn("text-sm font-medium", deadline.overdue ? "text-destructive" : "text-muted-foreground")}>
                            {deadline.label}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-primary">Start</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <ComingSoonPanel
            icon={Bell}
            title="No reminders yet"
            description="You're all caught up — nothing outstanding right now."
          />
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Your performance
        </div>
        <ComingSoonPanel
          icon={BarChart3}
          title="Performance metrics"
          description="Completion rates and quiz scores will show up here once course results are being saved."
        />
      </div>
    </div>
  );
}

// "/" is now the one unified Dashboard destination for every account (see
// app-shell.tsx's TOP_LINKS) — this is just the fork point: an operative
// (role === "member") gets the simple "what's assigned to me" welcome
// page; everyone else ("office user," regardless of their specific
// permission grants) gets the admin-style attention overview. Both halves
// are unchanged content from before this page started branching, just
// relocated into their own functions above.
export default async function DashboardHomePage() {
  const user = await getCurrentUser();
  return user.role === "member" ? <OperativeDashboard /> : <OfficeDashboard />;
}
