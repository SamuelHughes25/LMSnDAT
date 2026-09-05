import Link from "next/link";
import { BarChart3, Bell, BookOpen, ClipboardList } from "lucide-react";

import { ComingSoonPanel } from "@/components/course-preview/coming-soon-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Course } from "@/lib/course-types";
import { getCurrentUser } from "@/lib/dal";
import { djangoFetch } from "@/lib/django";
import type { Paginated, Template } from "@/lib/types";

// A welcome/home screen for operatives — real numbers where the data
// already exists (course/template counts), clearly-marked stubs for the
// features that need the next phases (assignment-by-role, submission
// syncing) before they can show anything real. Same "coming soon" honesty
// convention as the admin side's Activity/Analytics tabs.
export default async function PortalHomePage() {
  const [user, courses, templates] = await Promise.all([
    getCurrentUser(),
    djangoFetch<Paginated<Course>>("/courses/"),
    djangoFetch<Paginated<Template>>("/templates/"),
  ]);

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
              <div className="text-2xl font-semibold">{courses.count}</div>
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
              <div className="text-2xl font-semibold">{templates.count}</div>
              <p className="text-sm text-muted-foreground">audits to fill out</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Reminders</div>
        <ComingSoonPanel
          icon={Bell}
          title="No reminders yet"
          description="Once courses and audits can be assigned with due dates, what's due soon will show up here."
        />
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
