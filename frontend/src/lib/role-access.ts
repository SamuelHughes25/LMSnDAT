import "server-only";

import type { JobRole } from "./accounts-types";
import { getCurrentUser } from "./dal";
import { djangoFetch } from "./django";

// Role-based visibility is a MEMBER-only restriction. Admins/managers
// always see the full catalog regardless of their own job_role (typically
// none at all) — they're the ones curating and assigning content, so
// applying the same filter to them would hide everything rather than just
// unassigned content, and would make the admin dashboard's own portal
// preview unusable. `null` means "no restriction, show everything" — the
// same behavior every course/template had before job roles existed.
export async function getVisibleCourseIds(): Promise<Set<string> | null> {
  const user = await getCurrentUser();
  if (user.role !== "member") return null;
  if (!user.job_role) return new Set();
  const role = await djangoFetch<JobRole>(`/job-roles/${user.job_role}/`);
  return new Set(role.courses);
}

export async function getVisibleTemplateIds(): Promise<Set<string> | null> {
  const user = await getCurrentUser();
  if (user.role !== "member") return null;
  if (!user.job_role) return new Set();
  const role = await djangoFetch<JobRole>(`/job-roles/${user.job_role}/`);
  return new Set(role.templates);
}
