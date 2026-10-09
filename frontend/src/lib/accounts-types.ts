// Mirrors backend/apps/accounts/models.py and serializers.py — keep these
// in sync by hand for now (no shared schema codegen yet), same convention
// as course-types.ts/types.ts for their own domains.

export type UserRole = "admin" | "manager" | "member";

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
};
