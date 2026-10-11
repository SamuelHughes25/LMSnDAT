from rest_framework.permissions import SAFE_METHODS, BasePermission


def _has_role(user, roles):
    return bool(user and user.is_authenticated and (user.is_superuser or user.role in roles))


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        return _has_role(request.user, {'admin'})


class IsAdminOrManager(BasePermission):
    def has_permission(self, request, view):
        return _has_role(request.user, {'admin', 'manager'})


class IsAdminOrReadOnly(BasePermission):
    """Any authenticated user can read; only Admins can write.

    Not used by any dashboard-facing viewset any more — see
    HasDashboardTabAccess below, which replaced every such usage with
    configurable per-tab permission sets. Left in place (along with
    IsAdmin/IsAdminOrManager/IsAdminOrManagerOrReadOnly above/below) for
    apps.assignments/apps.submissions, which weren't part of that
    rework and still use the old fixed-role model.
    """

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return bool(request.user and request.user.is_authenticated)
        return _has_role(request.user, {'admin'})


class IsAdminOrManagerOrReadOnly(BasePermission):
    """Any authenticated user can read; only Admins/Managers can write.

    Same "no longer used by dashboard viewsets" note as IsAdminOrReadOnly
    above — kept for apps not covered by the permission-sets rework.
    """

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return bool(request.user and request.user.is_authenticated)
        return _has_role(request.user, {'admin', 'manager'})


# --- Permission sets ---
# Replaces the fixed admin/manager distinction above for every dashboard-
# facing viewset: WHAT a dashboard user can do is now entirely driven by
# an admin-configurable accounts.PermissionSet (one on/off switch per tab
# — Templates/Courses/Users/Groups/Permissions/Archive), not their `role`
# string. `role` still decides WHETHER someone reaches the dashboard at
# all (member -> portal only, unchanged, see (dashboard)/layout.tsx), just
# not what they can do once there.
#
# Two tiers sit above permission sets entirely, both bypassing every tab
# check:
#   - is_superuser (Django's own AbstractUser field) — the one
#     permanently-protected "super-super-user" account. Read-only in
#     UserSerializer (never settable via the API); UserViewSet.destroy/
#     purge both refuse to touch a row with this set.
#   - is_platform_admin (accounts.models.User's own new field) — the
#     "super user" tier: same full access, but revocable, and only by an
#     is_superuser account (see IsSuperuser below and UserViewSet's
#     grant_platform_admin/revoke_platform_admin actions).

# The six dashboard tabs a PermissionSet can grant — one list, shared by
# user_can_access_tab below and UserSerializer.get_accessible_tabs, so the
# two can never drift out of sync with each other or with
# accounts.models.PermissionSet's own can_access_<tab> fields.
DASHBOARD_TABS = ['templates', 'courses', 'users', 'groups', 'permissions', 'archive']


def user_can_access_tab(user, tab):
    """True if `user` has access to dashboard tab `tab` (one of
    'templates'/'courses'/'users'/'groups'/'permissions'/'archive') —
    either tier above, or their assigned PermissionSet's matching
    can_access_<tab> flag. No permission set at all means no access,
    full stop — unlike the old IsAdminOrReadOnly, there's no "anyone
    authenticated can at least read" fallback any more."""
    if not (user and user.is_authenticated):
        return False
    if user.is_superuser or user.is_platform_admin:
        return True
    return bool(user.permission_set and getattr(user.permission_set, f'can_access_{tab}', False))


class HasDashboardTabAccess(BasePermission):
    """Gates an entire viewset on one dashboard tab, read included — every
    viewset using this must set a `required_tab` class attribute (e.g.
    `required_tab = 'courses'`). Replaces IsAdminOrReadOnly/
    IsAdminOrManager/IsAdminOrManagerOrReadOnly across every dashboard-
    facing viewset (Course/Template and their child objects, Users,
    Teams, Groups, PermissionSets, and the Archive-only actions isolated
    on CourseViewSet/TemplateViewSet/UserViewSet via their own
    get_permissions() override)."""

    def has_permission(self, request, view):
        return user_can_access_tab(request.user, view.required_tab)


class HasArchiveTabAccess(BasePermission):
    """The archive/restore/purge actions isolated on CourseViewSet/
    TemplateViewSet/UserViewSet each need the 'archive' tab specifically
    — not whatever `required_tab` that same viewset otherwise uses for
    its own list/retrieve/create (e.g. 'courses'), so this hardcodes
    'archive' rather than reading view.required_tab like
    HasDashboardTabAccess does."""

    def has_permission(self, request, view):
        return user_can_access_tab(request.user, 'archive')


class HasArchiveTabAccessOrIsOwner(BasePermission):
    """Gates archive/restore/purge the same way HasArchiveTabAccess does,
    PLUS the content's own owner — a manager-equivalent permission set
    with no Archive tab granted should still be able to archive/restore/
    purge a course or template they personally own, per the user's own
    words: "only the owner of a course/template or the super user or
    super super user should" be able to delete it. is_superuser/
    is_platform_admin already pass via user_can_access_tab's own bypass,
    so they don't need a separate branch here.

    Only editors (not the owner) are deliberately excluded — this is
    stricter than IsContentOwnerEditorOrAdmin's edit-content check,
    matching the user's explicit "owner," not "owner or editor."
    `view.get_owning_content(obj)` resolves `obj` to the Course/Template
    itself, same method IsContentOwnerEditorOrAdmin relies on — for
    CourseViewSet/TemplateViewSet specifically, obj already IS that
    content.
    """

    message = "Only this item's owner or a super user can delete it."

    def has_permission(self, request, view):
        # No object yet at this stage (detail-route actions resolve it
        # via get_object()/check_object_permissions below) — defer the
        # real decision to has_object_permission.
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if user_can_access_tab(request.user, 'archive'):
            return True
        # Same role=='member' cutoff as user_can_edit_content's owner
        # bypass (see its own comment) — an operative who still happens to
        # own a course/template shouldn't be able to archive/restore/purge
        # it through a bookmarked URL once demoted off office-user access
        # entirely, any more than they should still be able to edit it.
        content = view.get_owning_content(obj)
        if content and content.owner_id == request.user.id and request.user.role != 'member':
            return True
        # DRF reads self.message (an *instance* attribute set here
        # overrides the class-level default above) when it raises the
        # 403 this False return triggers — naming the actual owner, not
        # just a generic "permission denied," is the whole point: the
        # user explicitly asked for guidance ("request the owner delete
        # it, or a super user") instead of a bare error.
        owner_name = content.owner.username if content and content.owner_id else "its owner"
        self.message = (
            f"Only {owner_name} (this item's owner) or a super user can delete it. "
            f"Ask {owner_name} to delete it, or contact a super user for help."
        )
        return False


class IsSuperuser(BasePermission):
    """Reserved for the one super-super-user tier — not tab-based at all.
    Used by UserViewSet.grant_platform_admin/revoke_platform_admin and
    CourseViewSet/TemplateViewSet.transfer_ownership: "only me the super
    super user can do this," per the user's own words, not "anyone with
    [Users/Courses/Templates] tab access" and — for transfer_ownership
    specifically — not "the content's own current owner" either any more.
    Ownership transfer used to be reachable by the owner themselves or by
    anyone with tab access (IsContentOwnerOrAdmin); deliberately tightened
    to this single tier because handing a course/template to someone else
    is now meant to be a rare, permanent, centrally-controlled action — an
    owner who transfers theirs away has no path to reclaim it themselves,
    and nobody short of the super-super-user can reassign it again after
    that either. set_editors is UNCHANGED (still IsContentOwnerOrAdmin) —
    this only ever applies to actual ownership."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


def user_can_edit_content(user, content, tab):
    """True if `user` can edit `content` (a Course or Template instance)
    — the matching dashboard tab ('courses' or 'templates', whichever
    `content` is), its current `owner`, or one of its `editors`. `content`
    may be None (an unresolved parent, e.g. a malformed create payload) —
    always False in that case.

    The owner/editor bypass below is deliberately gated on role != member
    — it exists so an OFFICE USER without the specific tab granted can
    still work on content they personally own/are assigned to edit,
    without needing blanket tab access to every course/template. It was
    never meant to survive someone being demoted all the way down to an
    operative: ownership/editor rows on a Course/Template are never
    cleared or reassigned when a user's role/permission_set/
    is_platform_admin changes (that's deliberate — see this function's own
    git history: the whole point is that a demoted user's content stays
    safely theirs, ready to resume the moment real access is granted back)
    — which means, before this check existed, an operative who'd once
    owned a course could still edit it indefinitely through a bookmarked
    builder URL even with the "Courses" nav link gone and zero manage
    permissions. role=='member' now hard-blocks that bypass regardless of
    ownership; full editing still resumes instantly the moment they're
    handed the matching tab (or promoted off 'member' entirely) — nothing
    about the ownership itself ever needs to change for that to work.
    """
    if content is None or not (user and user.is_authenticated):
        return False
    if user_can_access_tab(user, tab):
        return True
    if user.role == 'member':
        return False
    return content.owner_id == user.id or content.editors.filter(pk=user.pk).exists()


class IsContentOwnerEditorOrAdmin(BasePermission):
    """Any authenticated user can read; writing requires being the owner,
    a designated editor, or someone with dashboard access to the relevant
    tab ('courses' or 'templates') for the SPECIFIC Course/Template this
    object belongs to — a per-object check, unlike HasDashboardTabAccess's
    pure tab check. Used for Course/Template's own update/
    partial_update/create-draft, and every child object a course/template
    owns: CourseVersion, Lesson, Slide, CourseAsset, TemplateVersion,
    Section, Question.

    has_object_permission only fires for detail-route actions (retrieve/
    update/destroy, via get_object()) — it does NOT cover create, since
    there's no instance yet. Every viewset using this for create must
    additionally call user_can_edit_content(request.user, <resolved
    parent>, view.required_tab) inside its own perform_create and raise
    PermissionDenied on failure — mirrors CourseAssignmentViewSet
    .perform_create's existing manual object-level check beyond its
    class-level permission, not a new pattern here. Each such viewset
    must implement get_owning_content(obj) to resolve which Course/
    Template `obj` belongs to — trivial for Course/Template themselves
    (obj IS the content) and a short, fixed FK chain for everything else
    (e.g. Slide -> lesson -> course_version -> course) — and a
    `required_tab` class attribute ('courses' or 'templates') shared with
    HasDashboardTabAccess's own usage elsewhere on the same viewset.
    """

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        return user_can_edit_content(request.user, view.get_owning_content(obj), view.required_tab)


class IsContentOwnerOrAdmin(BasePermission):
    """Stricter than IsContentOwnerEditorOrAdmin above — managing WHO gets
    edit rights (transfer-ownership, set-editors) requires being the
    current owner, or dashboard access to the relevant tab; an editor
    cannot promote themselves or add other editors. Only ever used on
    CourseViewSet/TemplateViewSet's own transfer_ownership/set_editors
    actions, where `obj` (from self.get_object(), which calls
    check_object_permissions automatically) IS the Course/Template itself.
    """

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        # Same role=='member' cutoff as user_can_edit_content's own owner
        # bypass, and the same reasoning — an operative who still happens
        # to own a course shouldn't be able to transfer it away or add
        # editors to it through a bookmarked URL once they've been
        # demoted off anything resembling office-user access.
        if request.user.role == 'member':
            return user_can_access_tab(request.user, view.required_tab)
        return user_can_access_tab(request.user, view.required_tab) or obj.owner_id == request.user.id
