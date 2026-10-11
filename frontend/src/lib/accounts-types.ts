// Mirrors backend/apps/accounts/models.py and serializers.py — keep these
// in sync by hand for now (no shared schema codegen yet), same convention
// as course-types.ts/types.ts for their own domains.

export type UserRole = "admin" | "manager" | "member";

// A named bundle of dashboard tab access — replaces the old hardcoded
// admin/manager distinction for WHAT a dashboard user can actually do.
// One flat on/off switch per tab, full capability when on — no separate
// view-only tier, and no per-team scoping (see backend's
// apps.core.permissions.user_can_access_tab's own comment). `role` still
// decides WHETHER someone reaches the dashboard at all (member -> portal
// only, unchanged) — a PermissionSet only matters once they're there.
export type PermissionSet = {
  id: string;
  name: string;
  can_access_templates: boolean;
  can_access_courses: boolean;
  can_access_users: boolean;
  can_access_groups: boolean;
  can_access_permissions: boolean;
  can_access_archive: boolean;
  created_at: string;
  updated_at: string;
};

// An org-chart grouping with a manager — orthogonal to Group below (that
// gates content visibility; this is just "who reports to whom" and drives
// the manager-scoped queryset filtering already used throughout the
// backend, e.g. CourseAttemptViewSet).
export type Team = {
  id: number;
  name: string;
  description: string;
  manager: number | null;
  created_at: string;
  updated_at: string;
};

// A job-description-shaped content bundle (e.g. "Commercial Dwelling
// Engineer") — deliberately named Group, not Role, to avoid confusion with
// UserRole (the fixed admin/manager/member permission enum). Mixes
// whatever courses AND templates its owner decides into ONE bundle (a
// "Commercial Dwelling Engineer" group carries both that role's training
// courses and its audit templates together) — a user can belong to any
// number of groups at once, e.g. everyone gets "Don't Walk By" and
// "Asbestos Awareness" on top of their one job-description group. See
// Group's own doc comment in backend/apps/accounts/models.py for the full
// reasoning (an earlier pass split this into two independent CourseGroup/
// TemplateGroup models — reverted on explicit correction).
export type Group = {
  id: string;
  name: string;
  description: string;
  // Plain id arrays (not expanded objects) — same "PrimaryKeyRelatedField,
  // not a nested serializer" shape DRF returns by default, and exactly
  // what a PATCH back to /groups/{id}/ expects: a full replacement list of
  // ids, read-modify-write, same pattern as every other list mutation in
  // this app (see e.g. extra_images in course-types.ts's SlideConfig).
  courses: string[];
  templates: string[];
  member_count: number;
  created_at: string;
  updated_at: string;
};

// One row from /api/v1/users/ — the canonical shape for "a user record",
// re-exported as-is by lib/dal.ts's CurrentUser (the logged-in user is
// just one instance of this same shape) so the two never drift apart.
export type AccountUser = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  team: number | null;
  // A user can belong to any number of groups at once — their total
  // visible content (courses AND templates) is the union across all of
  // them (see role-access.ts). Plain id array, same convention as
  // Group.courses/templates above — never expanded to full group objects
  // here.
  content_groups: string[];
  date_joined: string;
  // "Archiving" a user reuses Django's own built-in is_active (false =
  // archived/deactivated, blocked from logging in) — see User model's own
  // comment in backend/apps/accounts/models.py. Read-only here, same as
  // archived_by/archived_at: these only ever change together, via the
  // archive/restore/purge actions in actions/users.ts.
  is_active: boolean;
  archived_by: number | null;
  archived_by_username: string | null;
  archived_at: string | null;
  // Dashboard tab access — see PermissionSet's own comment. Read-only:
  // only changes via a direct PATCH to `permission_set` (an ordinary
  // writable field, same as `role`/`team`) or, for is_platform_admin, the
  // dedicated grant/revoke-platform-admin actions.
  permission_set: string | null;
  permission_set_name: string | null;
  is_platform_admin: boolean;
  // Precomputed server-side (UserSerializer.get_accessible_tabs) — which
  // of the six dashboard tabs this user can currently reach, already
  // folding in the is_superuser/is_platform_admin bypass. Check with
  // `.includes("courses")` etc. rather than re-deriving this from
  // permission_set client-side.
  accessible_tabs: (
    "templates" | "courses" | "users" | "groups" | "permissions" | "archive"
  )[];
  // The one permanently-protected super-super-user tier — Django's own
  // builtin field, repurposed here. Always false for everyone except the
  // one account created directly via a one-off shell command; never
  // settable through the API at all (see backend's User.is_superuser's
  // own comment). Exposed read-only specifically so the frontend can
  // check "is the CURRENT viewer the superuser" (via /users/me/) to
  // decide whether to show the grant/revoke-platform-admin control.
  is_superuser: boolean;
};

// The human-facing label for "what tier is this account" — shown next to a
// username wherever the app currently shows one (dashboard header, portal
// header). Deliberately NOT `user.role` (admin/manager/member): role only
// ever decided whether someone reaches the dashboard at all, and has meant
// nothing about WHAT they can do there since the permission-sets rework —
// showing it next to the username read as a stale, misleading label (e.g.
// the super-super-user account showing "admin", as if it were just an
// ordinary permission-set holder with that role string). is_superuser and
// is_platform_admin both collapse to the same "Super user" label here on
// purpose — the super-super-user tier IS also, functionally, a super user
// (it bypasses every tab check the same way), with its extra protection
// (un-archivable/undeletable, the only account that can grant/revoke the
// tier below it) being an internal distinction this label was never meant
// to surface.
export function getUserTierLabel(
  user: Pick<AccountUser, "role" | "is_superuser" | "is_platform_admin" | "permission_set_name">,
): string {
  if (user.is_superuser || user.is_platform_admin) return "Super user";
  if (user.permission_set_name) return user.permission_set_name;
  // A member (portal-only, never had a permission set to begin with — see
  // role's own comment above) isn't "missing" dashboard access, they were
  // never meant to have any — "Operative" (this app's own established term
  // for them, see e.g. course-preview-viewer.tsx) reads correctly there,
  // where the fallback below would misleadingly suggest something's wrong.
  if (user.role === "member") return "Operative";
  return "No access";
}

// The human-facing label for "what KIND of account is this" — a
// completely different axis from getUserTierLabel above, which answers
// "what can they currently DO." This one only ever has two answers: an
// "Operative" (role === "member", portal-only — frontline/warehouse staff
// taking compliance training) or an "Office user" (any other role —
// office/admin staff, who may ALSO need to take the same training content
// as an operative, see app-shell.tsx's unified Templates/Courses nav items
// — and separately, independently, may or may not have been granted any
// manage-side access on top of that). Used wherever the app shows which
// category an account belongs to (the Users list/detail "Permission"
// column, the new-user dialog's picker) — never conflate this with
// getUserTierLabel's "Super user"/"[Permission Set]"/"No access", which
// answers a different question and uses a different pair of words.
export function getUserKindLabel(user: Pick<AccountUser, "role">): string {
  return user.role === "member" ? "Operative" : "Office user";
}
