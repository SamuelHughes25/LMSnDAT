import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AccountUser } from "@/lib/accounts-types";
import type { CourseAttempt } from "@/lib/attempt-types";
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

// Grouped-by-user summary row, aggregated here (in the server component)
// from the raw attempt list — no dedicated backend aggregation endpoint;
// at internal-tool scale a plain reduce over up to 200 fetched rows is
// simpler and avoids a second API shape to maintain.
type UserSummary = {
  userId: number;
  attemptCount: number;
  bestScore: number | null;
  passed: boolean | null;
  lastAttemptAt: string;
};

// Course existence/404 is already handled by the (detail) layout, which
// fetches the course itself — this page only needs the attempts list.
export default async function CourseAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // page_size=200 (DRF's configured max — see backend/apps/core/pagination.py)
  // rather than building pagination UI, fine at this app's scale.
  const attempts = await djangoFetch<Paginated<CourseAttempt>>(`/course-attempts/?course=${id}&page_size=200`);
  const allAttempts = attempts.results;
  const completed = allAttempts.filter((a) => a.status === "completed");
  const scored = completed.filter((a) => a.score !== null);
  const graded = completed.filter((a) => a.passed !== null);

  const uniqueUserIds = Array.from(new Set(allAttempts.map((a) => a.user)));
  const users = await Promise.all(uniqueUserIds.map((userId) => djangoFetch<AccountUser>(`/users/${userId}/`)));
  const userById = new Map(users.map((u) => [u.id, u]));

  const averageScore = scored.length
    ? scored.reduce((sum, a) => sum + (a.score ?? 0), 0) / scored.length
    : null;
  const passRate = graded.length ? (graded.filter((a) => a.passed).length / graded.length) * 100 : null;

  const summaries: UserSummary[] = uniqueUserIds.map((userId) => {
    const userAttempts = allAttempts.filter((a) => a.user === userId);
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Total attempts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{allAttempts.length}</div>
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

      <div className="rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Best score</TableHead>
              <TableHead>Passed</TableHead>
              <TableHead>Last attempt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summaries.map((summary) => {
              const user = userById.get(summary.userId);
              return (
                <TableRow key={summary.userId}>
                  <TableCell className="font-medium">{user?.username ?? summary.userId}</TableCell>
                  <TableCell>{summary.attemptCount}</TableCell>
                  <TableCell>{summary.bestScore === null ? "—" : `${summary.bestScore}%`}</TableCell>
                  <TableCell>
                    {summary.passed === null ? (
                      "—"
                    ) : summary.passed ? (
                      <Badge>Passed</Badge>
                    ) : (
                      <Badge variant="destructive">Not passed</Badge>
                    )}
                  </TableCell>
                  <TableCell>{new Date(summary.lastAttemptAt).toLocaleDateString()}</TableCell>
                </TableRow>
              );
            })}
            {summaries.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No one has attempted this course yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
