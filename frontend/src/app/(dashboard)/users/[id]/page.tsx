import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCourseHistoryTable, type CourseSummary } from "@/components/user-course-history-table";
import { UserGroupsEditor } from "@/components/user-groups-editor";
import type { AccountUser, Group, Team } from "@/lib/accounts-types";
import type { CourseAttempt } from "@/lib/attempt-types";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// Admin/manager only — this whole route sits under (dashboard)/, whose own
// layout already redirects members to /portal before this ever renders
// (see (dashboard)/layout.tsx), so no separate gate is needed here.
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let user: AccountUser;
  try {
    user = await djangoFetch<AccountUser>(`/users/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  const [team, groups, attempts] = await Promise.all([
    user.team ? djangoFetch<Team>(`/teams/${user.team}/`) : Promise.resolve(null),
    djangoFetch<Paginated<Group>>("/groups/"),
    // page_size=200 (DRF's configured max) rather than building pagination
    // UI — fine at this app's scale, same convention as the course
    // analytics page's own attempts fetch.
    djangoFetch<Paginated<CourseAttempt>>(`/course-attempts/?user=${id}&page_size=200`),
  ]);

  const currentGroups = groups.results.filter((g) => user.content_groups.includes(g.id));

  // Grouped by course, aggregated here (same "plain reduce over the fetched
  // list" approach the course analytics page already uses to group by
  // user) — the axis is just flipped, since this page already knows which
  // USER it's showing.
  const attemptsByCourse: Record<string, CourseAttempt[]> = {};
  for (const attempt of attempts.results) {
    (attemptsByCourse[attempt.course_id] ??= []).push(attempt);
  }
  const courseSummaries: CourseSummary[] = Object.entries(attemptsByCourse).map(([courseId, courseAttempts]) => {
    const scored = courseAttempts.filter((a) => a.score !== null);
    const bestScore = scored.length ? Math.max(...scored.map((a) => a.score ?? 0)) : null;
    const graded = courseAttempts.filter((a) => a.passed !== null);
    const passed = graded.length ? graded.some((a) => a.passed) : null;
    const lastAttemptAt = courseAttempts.reduce(
      (latest, a) => (a.started_at > latest ? a.started_at : latest),
      courseAttempts[0].started_at,
    );
    return {
      courseId,
      courseName: courseAttempts[0].course_name,
      attemptCount: courseAttempts.length,
      bestScore,
      passed,
      lastAttemptAt,
    };
  });
  courseSummaries.sort((a, b) => (a.lastAttemptAt < b.lastAttemptAt ? 1 : -1));

  return (
    <div className="space-y-6">
      <Link
        href="/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to users
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">{user.username}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {user.email && <span>{user.email}</span>}
          <Badge variant="outline" className="capitalize">
            {user.role}
          </Badge>
          {team && <span>Team: {team.name}</span>}
          <span>Joined {new Date(user.date_joined).toLocaleDateString()}</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Groups</CardTitle>
        </CardHeader>
        <CardContent>
          <UserGroupsEditor userId={user.id} currentGroups={currentGroups} availableGroups={groups.results} />
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Course history</h2>
        <UserCourseHistoryTable summaries={courseSummaries} attemptsByCourse={attemptsByCourse} />
      </div>
    </div>
  );
}
