import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminResetPasswordButton } from "@/components/admin-reset-password-button";
import { PlatformAdminToggle } from "@/components/platform-admin-toggle";
import { UserCourseHistoryTable, type CourseSummary } from "@/components/user-course-history-table";
import { UserGroupsEditor } from "@/components/user-groups-editor";
import { UserPermissionSetPicker } from "@/components/user-permission-set-picker";
import type { AccountUser, Group, PermissionSet, Team } from "@/lib/accounts-types";
import { getUserKindLabel } from "@/lib/accounts-types";
import type { CourseAttempt } from "@/lib/attempt-types";
import type { Course } from "@/lib/course-types";
import { getCurrentUser } from "@/lib/dal";
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

  const [viewer, team, groups, permissionSets, attempts, archivedCourses, activeCourses] = await Promise.all([
    // Whoever's VIEWING this page — the Grant/Revoke super user control
    // only renders for an is_superuser viewer (see below), independent of
    // whose profile (`user`) is being looked at.
    getCurrentUser(),
    user.team ? djangoFetch<Team>(`/teams/${user.team}/`) : Promise.resolve(null),
    djangoFetch<Paginated<Group>>("/groups/"),
    djangoFetch<Paginated<PermissionSet>>("/permission-sets/"),
    // page_size=200 (DRF's configured max) rather than building pagination
    // UI — fine at this app's scale, same convention as the course
    // analytics page's own attempts fetch.
    djangoFetch<Paginated<CourseAttempt>>(`/course-attempts/?user=${id}&page_size=200`),
    // Archived (not yet permanently deleted) courses still keep their
    // attempt history visible here, just clearly labeled — see
    // CourseViewSet.get_queryset's default exclusion, which is why this
    // needs its own explicit ?archived=true fetch. A permanently deleted
    // course needs no equivalent handling: its CourseAttempt rows are
    // purged by CourseViewSet.purge itself, so they simply stop appearing
    // in the attempts fetch above.
    djangoFetch<Paginated<Course>>("/courses/?archived=true"),
    // The non-archived half of the same split — needed so every course
    // this user has ever attempted (archived or not) has a resolvable
    // is_assessment flag for CourseSummary below, not just the archived
    // ones this page already happened to be fetching.
    djangoFetch<Paginated<Course>>("/courses/?page_size=200"),
  ]);
  const archivedCourseIds = new Set(archivedCourses.results.map((c) => c.id));
  const isAssessmentByCourseId = new Map(
    [...archivedCourses.results, ...activeCourses.results].map((c) => [c.id, c.is_assessment]),
  );

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
      isArchived: archivedCourseIds.has(courseId),
      // Falls back to false (not an assessment) rather than true if the
      // course is somehow missing from the map — a permanently purged
      // course never reaches here at all (its CourseAttempt rows are
      // purged along with it, see the fetch comment above), so this
      // should never actually trigger; false is the safer default either
      // way, since it just reads as "Not an assessment" rather than
      // fabricating a pass/fail claim for a course this page couldn't
      // actually verify.
      isAssessment: isAssessmentByCourseId.get(courseId) ?? false,
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

      <div className="rounded-lg border-2 border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="text-2xl font-semibold">{user.username}</h1>
            {user.email && <p className="text-sm text-muted-foreground">{user.email}</p>}
          </div>
          {/* Permission + team + created date, all one row, consistent
              label-over-value pairs instead of the previous loose run of
              differently-styled inline elements (a Badge mixed in with
              plain spans and no separation) that read as messy/scattered. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <div className="text-xs text-muted-foreground">Type</div>
              <Badge variant="outline" className="mt-1">
                {getUserKindLabel(user)}
              </Badge>
            </div>
            {/* Dashboard access — shown regardless of role now: an
                operative can be granted is_superuser/is_platform_admin/a
                permission set exactly the same as an office user (see
                app-shell.tsx's unified nav, which is what actually makes a
                grant like that reach anything now). Hiding this whole
                section behind a role check used to mean a real grant on an
                operative's account had no visible confirmation anywhere on
                this page. The protected super-super-user and revocable
                super user tiers both bypass permission sets entirely, so
                they get their own read-only badge instead of the picker. */}
            <div>
              <div className="text-xs text-muted-foreground">Permissions</div>
              {user.is_superuser ? (
                <Badge className="mt-1">Super-super-user (protected)</Badge>
              ) : user.is_platform_admin ? (
                <Badge className="mt-1">Super user (full access)</Badge>
              ) : (
                <UserPermissionSetPicker
                  userId={user.id}
                  currentPermissionSetId={user.permission_set}
                  currentPermissionSetName={user.permission_set_name}
                  availablePermissionSets={permissionSets.results}
                />
              )}
            </div>
            {team && (
              <div>
                <div className="text-xs text-muted-foreground">Team</div>
                <div className="mt-1 text-sm font-medium">{team.name}</div>
              </div>
            )}
            <div>
              <div className="text-xs text-muted-foreground">Created</div>
              <div className="mt-1 text-sm font-medium">{new Date(user.date_joined).toLocaleDateString()}</div>
            </div>
            {/* Only an is_superuser VIEWER ever sees this, regardless of
                whose profile it is — "only me the super super user can do
                this." Never shown on the superuser's own row (nothing to
                grant/revoke, or reset, there — SuperSam manages their own
                password from /account instead). Reset password sits right
                alongside Grant/Revoke super user, per the user's own
                request — both are "things only I should casually be able
                to do to someone else's account from here." */}
            {viewer.is_superuser && !user.is_superuser && (
              <div>
                <div className="text-xs text-muted-foreground">Super user tier</div>
                <div className="mt-1 flex items-center gap-2">
                  <PlatformAdminToggle userId={user.id} isPlatformAdmin={user.is_platform_admin} />
                  <AdminResetPasswordButton userId={user.id} username={user.username} />
                </div>
              </div>
            )}
          </div>
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
