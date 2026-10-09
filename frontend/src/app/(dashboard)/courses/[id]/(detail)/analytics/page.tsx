import { CourseAnalyticsTable, type UserSummary } from "@/components/course-analytics-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AccountUser } from "@/lib/accounts-types";
import type { CourseAttempt, CourseDeadlineExtension } from "@/lib/attempt-types";
import type { Course } from "@/lib/course-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// A simple, dependency-free horizontal bar — no charting library exists
// anywhere in this frontend and "basic" metrics don't warrant adding one
// (see the Phase 2 plan). Just a width:X% div over a muted track.
function StatBar({ label, percent }: { label: string; percent: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(percent)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  );
}

// Course existence/404 is already handled by the (detail) layout, which
// fetches the course itself — this page only needs the attempts list.
export default async function CourseAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // page_size=200 (DRF's configured max — see backend/apps/core/pagination.py)
  // rather than building pagination UI, fine at this app's scale.
  const [course, attempts] = await Promise.all([
    djangoFetch<Course>(`/courses/${id}/`),
    djangoFetch<Paginated<CourseAttempt>>(`/course-attempts/?course=${id}&page_size=200`),
  ]);
  const allAttempts = attempts.results;
  const completed = allAttempts.filter((a) => a.status === "completed");
  const scored = completed.filter((a) => a.score !== null);
  const graded = completed.filter((a) => a.passed !== null);

  const uniqueUserIds = Array.from(new Set(allAttempts.map((a) => a.user)));
  const users = await Promise.all(uniqueUserIds.map((userId) => djangoFetch<AccountUser>(`/users/${userId}/`)));

  const averageScore = scored.length
    ? scored.reduce((sum, a) => sum + (a.score ?? 0), 0) / scored.length
    : null;
  const passRate = graded.length ? (graded.filter((a) => a.passed).length / graded.length) * 100 : null;

  // How hard/easy this course actually is, in one number: on average, how
  // many pass-or-fail attempts does it take one person to get a verdict?
  // Deliberately over GRADED attempts only (a real pass/fail outcome, not
  // just "started" or "completed with no assessment to grade against") —
  // a raw total-attempts count conflates "lots of people took this once"
  // with "a few people struggled through many retakes," which says
  // nothing about difficulty; this isolates the retake signal instead.
  const uniqueGradedUserIds = new Set(graded.map((a) => a.user));
  const averageAttemptsPerPerson = uniqueGradedUserIds.size ? graded.length / uniqueGradedUserIds.size : null;

  // Grouped-by-user, aggregated here (in the server component) from the raw
  // attempt list — no dedicated backend aggregation endpoint; at
  // internal-tool scale a plain reduce over up to 200 fetched rows is
  // simpler and avoids a second API shape to maintain. `attemptsByUser`
  // (every one of a user's own CourseAttempt rows — one per full
  // course play-through, never a per-slide/per-question count) is what
  // powers the table's own expand-to-see-every-attempt row.
  const attemptsByUser: Record<number, CourseAttempt[]> = {};
  for (const userId of uniqueUserIds) {
    attemptsByUser[userId] = allAttempts.filter((a) => a.user === userId);
  }

  const summaries: UserSummary[] = uniqueUserIds.map((userId) => {
    const userAttempts = attemptsByUser[userId];
    const userScored = userAttempts.filter((a) => a.score !== null);
    const bestScore = userScored.length ? Math.max(...userScored.map((a) => a.score ?? 0)) : null;
    // "Passed" for the table means at least one of this user's attempts
    // passed — same "have they ever cleared it" semantics as the portal's
    // own retake reminder (see role-access.ts/portal/page.tsx).
    const gradedForUser = userAttempts.filter((a) => a.passed !== null);
    const passed = gradedForUser.length ? gradedForUser.some((a) => a.passed) : null;
    const lastAttemptAt = userAttempts.reduce(
      (latest, a) => (a.started_at > latest ? a.started_at : latest),
      userAttempts[0].started_at,
    );
    return { userId, attemptCount: userAttempts.length, bestScore, passed, lastAttemptAt };
  });
  summaries.sort((a, b) => (a.lastAttemptAt < b.lastAttemptAt ? 1 : -1));

  // Only fetched/shown at all when the course actually has a deadline —
  // effective deadline is a per-user extension if one exists, else the
  // course's own default (see Course.effective_deadline_for() in
  // backend/apps/courses/models.py, mirrored here client-side since this
  // page already has both pieces in hand).
  let deadlineByUser: Record<number, string | null> | undefined;
  if (course.deadline) {
    const extensions = await djangoFetch<Paginated<CourseDeadlineExtension>>(
      `/course-deadline-extensions/?course=${id}&page_size=200`,
    );
    const extensionByUser = new Map(extensions.results.map((e) => [e.user, e.extended_deadline]));
    deadlineByUser = Object.fromEntries(
      uniqueUserIds.map((userId) => [userId, extensionByUser.get(userId) ?? course.deadline]),
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Card>
          <CardHeader>
            {/* Attempts on the COURSE — one row per full play-through
                (CourseAttempt), never a per-slide/per-question count (that's
                what SlideResult is, and it never surfaces as a top-level
                metric here). */}
            <CardTitle className="text-sm text-muted-foreground">Attempts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{allAttempts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Avg. attempts per person</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {averageAttemptsPerPerson === null ? "—" : averageAttemptsPerPerson.toFixed(1)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Users attempted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{uniqueUserIds.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Average score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {averageScore === null ? "—" : `${Math.round(averageScore)}%`}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Pass rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{passRate === null ? "—" : `${Math.round(passRate)}%`}</div>
          </CardContent>
        </Card>
      </div>

      {(averageScore !== null || passRate !== null) && (
        <div className="max-w-md space-y-3 rounded-lg border-2 border-border bg-card p-4 shadow-sm">
          {averageScore !== null && <StatBar label="Average score" percent={averageScore} />}
          {passRate !== null && <StatBar label="Pass rate" percent={passRate} />}
        </div>
      )}

      <CourseAnalyticsTable
        summaries={summaries}
        usersById={Object.fromEntries(users.map((u) => [u.id, u]))}
        attemptsByUser={attemptsByUser}
        courseId={id}
        deadlineByUser={deadlineByUser}
      />
    </div>
  );
}
