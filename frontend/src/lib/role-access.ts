import "server-only";

import type { Group } from "./accounts-types";
import type { CourseAssignment } from "./course-types";
import { getCurrentUser } from "./dal";
import { djangoFetch } from "./django";
import type { Paginated } from "./types";

// Role-based visibility is a MEMBER-only restriction. Admins/managers
// always see the full catalog regardless of their own group memberships
// (typically none at all) — they're the ones curating and assigning
// content, so applying the same filter to them would hide everything
// rather than just unassigned content, and would make the admin
// dashboard's own portal preview unusable. `null` means "no restriction,
// show everything" — the same behavior every course/template had before
// groups existed.
//
// A member's visible set is the UNION of every group they belong to (they
// can belong to several at once) — each group bundles both course and
// template access together, so getVisibleCourseIds/getVisibleTemplateIds
// just pick out the relevant half of the same fetched groups.
async function getMemberGroups(): Promise<Group[] | null> {
  const user = await getCurrentUser();
  if (user.role !== "member") return null;
  if (user.content_groups.length === 0) return [];
  return Promise.all(user.content_groups.map((id) => djangoFetch<Group>(`/groups/${id}/`)));
}

// A course directly assigned to this member, independent of any Group —
// see CourseAssignment's own comment in course-types.ts. `/course-assignments/`
// is already scoped server-side to "my own rows" for a member (see
// CourseAssignmentViewSet.get_queryset), so no `?user=` param is needed
// here — same "no param, the backend already scopes it to me" pattern
// CourseAttempt-based portal code elsewhere in this app already relies on.
async function getDirectCourseAssignmentIds(): Promise<string[]> {
  const user = await getCurrentUser();
  if (user.role !== "member") return [];
  const assignments = await djangoFetch<Paginated<CourseAssignment>>("/course-assignments/");
  return assignments.results.map((a) => a.course);
}

// Deliberately a plain union into ONE Set, not two separately-tracked
// sources — a course reachable through several Groups AND a direct
// assignment at once is expected, not a conflict (see the Members tab,
// which never cross-checks the two against each other). Sets silently
// collapse duplicates, so however many sources grant a course, it ends up
// counted exactly once here — the portal course list showing it exactly
// once follows for free from that, with no extra de-duplication code
// needed anywhere.
export async function getVisibleCourseIds(): Promise<Set<string> | null> {
  const [groups, directIds] = await Promise.all([getMemberGroups(), getDirectCourseAssignmentIds()]);
  if (groups === null) return null;
  return new Set([...groups.flatMap((g) => g.courses), ...directIds]);
}

export async function getVisibleTemplateIds(): Promise<Set<string> | null> {
  const groups = await getMemberGroups();
  if (groups === null) return null;
  return new Set(groups.flatMap((g) => g.templates));
}
