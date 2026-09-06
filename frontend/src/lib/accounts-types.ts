// Mirrors backend/apps/accounts/models.py and serializers.py — keep these
// in sync by hand for now (no shared schema codegen yet), same convention
// as course-types.ts/types.ts for their own domains.

export type UserRole = "admin" | "manager" | "member";

// A job-title-based content bundle (e.g. "Gas Engineer") — deliberately
// named JobRole here too, matching the backend model, to avoid confusion
// with UserRole (the fixed admin/manager/member permission enum) even
// though the UI itself just calls this "Roles". See JobRole's own doc
// comment in backend/apps/accounts/models.py for the full reasoning.
export type JobRole = {
  id: string;
  name: string;
  description: string;
  // Plain id arrays (not expanded objects) — same "PrimaryKeyRelatedField,
  // not a nested serializer" shape DRF returns by default, and exactly
  // what a PATCH back to /job-roles/{id}/ expects: a full replacement list
  // of ids, read-modify-write, same pattern as every other list mutation
  // in this app (see e.g. extra_images in course-types.ts's SlideConfig).
  courses: string[];
  templates: string[];
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
  // A user's assigned JobRole id, or null if unassigned — never expanded
  // to the full JobRole object here, same "id only" convention as
  // JobRole.courses/templates above.
  job_role: string | null;
  date_joined: string;
};
