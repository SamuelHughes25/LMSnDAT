import Link from "next/link";
import { BarChart3, Bell, BookOpen, ClipboardList } from "lucide-react";

import { ComingSoonPanel } from "@/components/course-preview/coming-soon-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CourseAttempt } from "@/lib/attempt-types";
import type { Course } from "@/lib/course-types";
import { type CurrentUser, getCurrentUser } from "@/lib/dal";
import { djangoFetch } from "@/lib/django";
import { getVisibleCourseIds, getVisibleTemplateIds } from "@/lib/role-access";
import type { Paginated, Template } from "@/lib/types";

// Real reminders: an assessment course (is_assessment + a passing_score
// set) the member hasn't yet passed. "Passed" means ANY of their own
// attempts at it has passed=true — CourseAttempt's role-scoping already
// limits /course-attempts/?course=<id> to a member's own rows, so no
// extra user filter is needed here. One fetch per assessment course
// (rather than one big fetch + a course_version->course lookup) since
// there's typically only a handful of assessments visible to any one
// member — simplest correct option at this app's scale. Admins/managers
// never get real reminders here (they're not the ones with a personal
// course to retake) — an empty list falls back to the same "No reminders"
// panel as a member with nothing outstanding.
async function getRetakeReminders(user: CurrentUser, courses: Course[], visibleIds: Set<string> | null) {
  if (user.role !== "member") return [];
  const assessments = courses.filter(
    (c) => c.is_assessment && c.passing_score !== null && (visibleIds === null || visibleIds.has(c.id)),
  );
  if (assessments.length === 0) return [];
  const results = await Promise.all(
    assessments.map(async (course) => {
      const attempts = await djangoFetch<Paginated<CourseAttempt>>(`/course-attempts/?course=${course.id}`);
      return attempts.results.some((a) => a.passed === true) ? null : course;
    }),
  );
  return results.filter((c): c is Course => c !== null);
}

// A welcome/home screen for operatives — real numbers where the data
// already exists (course/template counts, and now real retake reminders).
// Same "coming soon" honesty convention as the admin side's Activity tab
// for the one panel ("Your performance") still awaiting Phase 3.
export default async function PortalHomePage() {
  const [user, courses, templates, visibleCourseIds, visibleTemplateIds] = await Promise.all([
    getCurrentUser(),
    djangoFetch<Paginated<Course>>("/courses/"),
    djangoFetch<Paginated<Template>>("/templates/"),
    getVisibleCourseIds(),
    getVisibleTemplateIds(),
  ]);

  const needsRetake = await getRetakeReminders(user, courses.results, visibleCourseIds);

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
        {needsRetake.length > 0 ? (
          <div className="space-y-2">
            {needsRetake.map((course) => (
              <Link key={course.id} href={`/portal/courses/${course.id}`}>
                <div className="flex items-center justify-between rounded-lg border-2 border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40">
                  <div className="flex items-center gap-3">
                    <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{course.name}</div>
                      <p className="text-sm text-muted-foreground">
                        You haven&apos;t passed this yet — minimum {course.passing_score}% required.
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-primary">Retake</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <ComingSoonPanel
            icon={Bell}
            title="No reminders yet"
            description="You're all caught up — nothing to retake right now."
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
