import type { PermissionTabField } from "@/app/actions/permission-sets";

// One entry per dashboard tab a PermissionSet can grant — the single
// source of truth for both the Permissions table's columns and the
// create/edit dialog's tab strip, so the two can never drift apart. A
// sub-permission only ever matters once its own section's conditions are
// met (the parent tab for Users' own four; per-course owner/editor status
// for Courses' own three — see apps.core.permissions
// .user_can_manage_users_admin/user_can_manage_course_admin on the
// backend) — `requiresParent` drives whether the dialog disables a
// sub-permission's checkbox until the parent is checked.
export const PERMISSION_SET_SECTIONS: {
  tab: PermissionTabField;
  label: string;
  subPermissions: { field: PermissionTabField; label: string; description: string }[];
  requiresParent: boolean;
}[] = [
  { tab: "can_access_templates", label: "Templates", subPermissions: [], requiresParent: false },
  {
    tab: "can_access_courses",
    label: "Courses",
    requiresParent: false,
    subPermissions: [
      {
        field: "can_edit_course_members",
        label: "Edit members",
        description: "Add/remove editors and direct assignments on a course they own or edit.",
      },
      {
        field: "can_edit_course_groups",
        label: "Edit groups",
        description: "Add/remove a course they own or edit from Groups.",
      },
      {
        field: "can_edit_course_settings",
        label: "Edit settings",
        description: "Change a course's own name, thumbnail, assessment, and deadline settings.",
      },
    ],
  },
  {
    tab: "can_access_users",
    label: "Users",
    requiresParent: true,
    subPermissions: [
      { field: "can_create_users", label: "Create users", description: "Create new user accounts." },
      { field: "can_delete_users", label: "Delete users", description: "Archive/restore/permanently delete users." },
      {
        field: "can_reset_user_passwords",
        label: "Reset passwords",
        description: "Overwrite another user's password.",
      },
      {
        field: "can_edit_users",
        label: "Edit users",
        description: "Change account type, permissions, team, and groups.",
      },
    ],
  },
  { tab: "can_access_groups", label: "Groups", subPermissions: [], requiresParent: false },
  { tab: "can_access_permissions", label: "Permissions", subPermissions: [], requiresParent: false },
  { tab: "can_access_archive", label: "Archive", subPermissions: [], requiresParent: false },
];
