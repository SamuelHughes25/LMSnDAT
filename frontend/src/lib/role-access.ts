import "server-only";

import type { DashboardTab, Group } from "./accounts-types";
import type { Course, CourseAssignment } from "./course-types";
import { getCurrentUser } from "./dal";
import { djangoFetch } from "./django";
import type { Paginated } from "./types";
import type { Template } from "./types";

// This file answers two related, but genuinely different, questions about
// what the current user is allowed to do — co-located deliberately so
// there's exactly one place to look (and to update, as permissions keep
// evolving) rather than two drifting-apart systems:
//   - hasTabAccess: can this user open a given DASHBOARD TAB at all
//     (Courses/Templates/Users/Groups/Permissions/Archive)? Mirrors the
//     backend's own apps.core.permissions.user_can_access_tab exactly —
//     same AccountUser.accessible_tabs field that check already populates,
//     just read from the Next.js side instead of re-derived.
//   - getVisibleCourseIds/getVisibleTemplateIds (below): WHICH specific
//     courses/templates can this user see at all, independent of tab
//     access — a course you're not owner/editor/assigned to doesn't show
//     up for you even with the Courses tab (that tab is about MANAGING the
//     catalog, not about being personally assigned something to take).
// Every dashboard page that gates on a tab should call hasTabAccess and
// render <AccessDenied /> (components/access-denied.tsx) instead of the
// real page content when it's false — see that component's own doc
// comment for why a direct in-place message, not a silent redirect.
export async function hasTabAccess(tab: DashboardTab): Promise<boolean> {
  const user = await getCurrentUser();
  return user.accessible_tabs.includes(tab);
}

// Mirrors backend apps.core.permissions.user_can_edit_content exactly —
// tab access OR (not a portal member AND owner/editor of this specific
// content). Used wherever a Course/Template sub-page needs to gate on
// "can edit this content" but the content itself has no server-computed
// viewer_can_edit_* field of its own — Templates don't have Courses' own
// granular per-tab sub-permission split (can_edit_course_members/
// _groups/_settings/_deadlines), just this one coarser check.
export async function canEditOwnedContent(
  content: { owner: number; editors: number[] },
  tab: Extract<DashboardTab, "courses" | "templates">,
): Promise<boolean> {
  const user = await getCurrentUser();
  if (user.accessible_tabs.includes(tab)) return true;
  if (user.role === "member") return false;
  return content.owner === user.id || content.editors.includes(user.id);
}

// `null` means "no restriction, show everything" — reserved for the
// is_superuser/is_platform_admin tier ONLY, the same blanket bypass every
// other permission check in this app gives them (see Course.is_accessible_by's
// own docstring on the backend for the mirrored server-side check). Every
// other account — office user or operative alike — is restricted to
// exactly what getVisibleCourseIds/getVisibleTemplateIds resolve below,
// REGARDLESS of permission set/tab access: having the Courses tab is
// about MANAGING the catalog (creating courses, editing settings), not
// about being personally assigned something to take, and this function
// used to conflate the two — any office user (role 'admin'/'manager',
// with or without the Courses tab) saw and could open/complete every
// course that existed, confirmed directly as a real gap and not just a
// cosmetic one (CourseAttemptViewSet.perform_create had no equivalent
// check either, now closed server-side too — this is defense-in-depth
// for the UI, not the only thing stopping it).
async function getGroups(): Promise<Group[]> {
  const user = await getCurrentUser();
  if (user.content_groups.length === 0) return [];
  return Promise.all(user.content_groups.map((id) => djangoFetch<Group>(`/groups/${id}/`)));
}

// A course directly assigned to this viewer, independent of any Group —
// see CourseAssignment's own comment in course-types.ts. `/course-assignments/`
// is already scoped server-side to "my own rows" for anyone without the
// Courses tab (see CourseAssignmentViewSet.get_queryset) — true for every
// account this ever actually runs for, since the superuser/platform_admin
// bypass below means they never call this at all.
async function getDirectCourseAssignmentIds(): Promise<string[]> {
  const assignments = await djangoFetch<Paginated<CourseAssignment>>("/course-assignments/");
  return assignments.results.map((a) => a.course);
}

// Deliberately a plain union into ONE Set, not several separately-tracked
// sources — a course reachable through several Groups, a direct
// assignment, AND being its own owner/editor all at once is expected, not
// a conflict. Sets silently collapse duplicates, so however many sources
// grant a course, it ends up counted exactly once here — the portal
// course list showing it exactly once follows for free from that, with no
// extra de-duplication code needed anywhere.
export async function getVisibleCourseIds(): Promise<Set<string> | null> {
  const user = await getCurrentUser();
  if (user.is_superuser || user.is_platform_admin) return null;
  const [groups, directIds, courses] = await Promise.all([
    getGroups(),
    getDirectCourseAssignmentIds(),
    // /courses/ is deliberately open-read to every authenticated user
    // (see CourseViewSet.get_permissions' own comment) — this is the one
    // place that reads it just to resolve owner/editors membership, same
    // as every other field on this same already-fetched catalog.
    djangoFetch<Paginated<Course>>("/courses/"),
  ]);
  const ownedOrEditedIds = courses.results
    .filter((c) => c.owner === user.id || c.editors.includes(user.id))
    .map((c) => c.id);
  return new Set([...groups.flatMap((g) => g.courses), ...directIds, ...ownedOrEditedIds]);
}

export async function getVisibleTemplateIds(): Promise<Set<string> | null> {
  const user = await getCurrentUser();
  if (user.is_superuser || user.is_platform_admin) return null;
  const [groups, templates] = await Promise.all([
    getGroups(),
    djangoFetch<Paginated<Template>>("/templates/"),
  ]);
  const ownedOrEditedIds = templates.results
    .filter((t) => t.owner === user.id || t.editors.includes(user.id))
    .map((t) => t.id);
  return new Set([...groups.flatMap((g) => g.templates), ...ownedOrEditedIds]);
}
