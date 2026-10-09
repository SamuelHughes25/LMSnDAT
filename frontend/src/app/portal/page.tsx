import Link from "next/link";
import { BarChart3, Bell, BookOpen, ClipboardList } from "lucide-react";

import { ComingSoonPanel } from "@/components/course-preview/coming-soon-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCourseReminders, reminderReason } from "@/lib/course-reminders";
import type { Course } from "@/lib/course-types";
import { getCurrentUser } from "@/lib/dal";
import { deadlineStatus } from "@/lib/deadline";
import { djangoFetch } from "@/lib/django";
import { getVisibleCourseIds, getVisibleTemplateIds } from "@/lib/role-access";
import type { Paginated, Template } from "@/lib/types";
import { cn } from "@/lib/utils";

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
