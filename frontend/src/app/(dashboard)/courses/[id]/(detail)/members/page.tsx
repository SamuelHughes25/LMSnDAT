import { notFound } from "next/navigation";
import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Course } from "@/lib/course-types";
import type { CurrentUser } from "@/lib/dal";
import { DjangoApiError, djangoFetch } from "@/lib/django";

export default async function CourseMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let course: Course;
  try {
    course = await djangoFetch<Course>(`/courses/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  // created_by is a raw user id on Course — resolve it to a display name via
  // the users detail endpoint (visible to admins for any user).
  const owner = await djangoFetch<CurrentUser>(`/users/${course.created_by}/`);
  const ownerName = `${owner.first_name} ${owner.last_name}`.trim() || owner.username;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Owner</div>
        <div className="flex items-center justify-between rounded-lg border-2 border-border bg-card p-4 shadow-sm">
          <div>
            <div className="font-medium">{ownerName}</div>
            <div className="text-sm text-muted-foreground">{owner.username}</div>
          </div>
          <Badge variant="outline" className="capitalize">
            {owner.role}
          </Badge>
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Members</div>
        <div className="flex h-40 flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-6 text-center shadow-sm">
          <Users className="mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Member assignment isn&apos;t built yet — this is where managers will assign this course to teams
            and individuals.
          </p>
        </div>
      </div>
    </div>
  );
}
