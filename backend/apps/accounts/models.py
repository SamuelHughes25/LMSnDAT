from django.contrib.auth.models import AbstractUser
from django.db import models

from apps.core.models import BaseModel


class Team(BaseModel):
    name = models.CharField(max_length=255, unique=True)
    description = models.TextField(blank=True)
    manager = models.ForeignKey(
        'accounts.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='managed_teams',
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Group(BaseModel):
    """A job-description-shaped content bundle (e.g. "Commercial Dwelling
    Engineer") — deliberately named Group, not Role, to avoid colliding
    with User.Role below: that's a fixed 3-value permission enum (admin/
    manager/member), this is an admin-creatable record that determines
    which courses AND templates get pushed to whoever belongs to it, as one
    bundle the group's owner assembles from both. Orthogonal to Team (an
    org-chart grouping with a manager) — a user can be on "Team North" and
    in the group "Commercial Dwelling Engineer" independently.

    A user can belong to any number of groups at once (see User.content_groups
    below) — e.g. everyone gets "Don't Walk By" and "Asbestos Awareness" on
    top of whichever single group matches their actual job description, and
    their total visible content is the union across every group they're in.

    An earlier pass split this into two separate models (CourseGroup/
    TemplateGroup, course access and template access as fully independent
    concepts) — reverted on explicit correction: the actual intent is one
    group mixing both, decided together by whoever owns it (e.g. a
    "Commercial Dwelling Engineer" group bundles that role's training
    courses AND its audit templates as a single assignable unit), not two
    parallel systems a person has to assemble in step.

    `courses`/`templates` are plain M2M fields (not a through-model with
    extra metadata) since this only needs "is this course/template part of
    this group's bundle," not who assigned it or when — a deliberate scope
    narrowing, not an oversight.
    """

    name = models.CharField(max_length=255, unique=True)
    description = models.TextField(blank=True)
    courses = models.ManyToManyField('courses.Course', blank=True, related_name='groups')
    templates = models.ManyToManyField('templates_app.Template', blank=True, related_name='groups')

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class PermissionSet(BaseModel):
    """A named, admin-creatable bundle of dashboard tab access — replaces
    the old hardcoded admin/manager distinction for WHAT a dashboard user
    can actually do. One flat on/off switch per tab, full capability when
    on (view, create, edit, archive) — no separate view-only tier, and no
    per-team scoping: granting `can_access_users`, for example, means
    every user, globally, not just a manager's own team the way the old
    `role`-based checks worked. See apps.core.permissions
    .user_can_access_tab() for how this is actually enforced, and
    User.is_superuser/is_platform_admin below for the two tiers that
    bypass this entirely.

    Deliberately does NOT include `role`'s `member` value as a tab — a
    portal/operative user never reaches the dashboard at all (see
    (dashboard)/layout.tsx's own redirect), so permission sets have
    nothing to grant them.
    """

    name = models.CharField(max_length=255, unique=True)
    can_access_templates = models.BooleanField(default=False)
    # Unlike every other can_access_* flag, this one no longer means "see
    # every course" — it grants the Courses section itself (and the
    # ability to create a new course, which makes you its owner) plus
    # read access to whatever course you already own/are an editor on.
    # Which SPECIFIC courses show up, and whether you can touch their
    # Members/Groups/Settings tabs, is governed by ownership/editor status
    # and the four can_edit_course_* flags below — see
    # apps.core.permissions.user_can_manage_course_admin.
    can_access_courses = models.BooleanField(default=False)
    can_access_users = models.BooleanField(default=False)
    can_access_groups = models.BooleanField(default=False)
    # Managing PermissionSets themselves — without this, a set that can
    # grant every OTHER tab still can't touch this one, so handing out
    # unrestricted tab access to someone doesn't implicitly also hand them
    # the ability to grant it to others too.
    can_access_permissions = models.BooleanField(default=False)
    can_access_archive = models.BooleanField(default=False)

    # --- Users sub-permissions ---
    # Each is meaningless without can_access_users itself (see
    # user_can_manage_users_admin) — the parent flag is what gets you to
    # the tab/search at all; these further split WHAT you can do there,
    # same granularity the user asked for on top of the old "one flat
    # switch = full capability" model.
    can_create_users = models.BooleanField(default=False)
    can_delete_users = models.BooleanField(default=False)
    can_reset_user_passwords = models.BooleanField(default=False)
    # Role/permission_set/content_groups/team and other ordinary profile
    # fields — NOT password (see can_reset_user_passwords above, its own,
    # separate sub-permission).
    can_edit_users = models.BooleanField(default=False)

    # --- Courses sub-permissions ---
    # Each only matters for a course you already own or are an editor on
    # (can_access_courses's own docstring) — the owner always has all
    # three regardless of these flags; a plain editor needs the matching
    # one on top of editor status. See user_can_manage_course_admin.
    can_edit_course_members = models.BooleanField(default=False)
    can_edit_course_groups = models.BooleanField(default=False)
    can_edit_course_settings = models.BooleanField(default=False)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = 'admin', 'Admin'
        MANAGER = 'manager', 'Manager'
        MEMBER = 'member', 'Member'

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)
    team = models.ForeignKey(
        'accounts.Team',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='members',
    )
    # A user can belong to any number of groups at once — their total
    # visible content (courses AND templates) is the UNION across all of
    # them (see role-access.ts's getVisibleCourseIds/getVisibleTemplateIds).
    # Named content_groups, not `groups` — AbstractUser/PermissionsMixin
    # already defines `groups` as Django's own built-in auth-permissions
    # M2M (unused elsewhere in this app, but redefining the same name would
    # shadow it and invite confusion with Django's own permission system).
    content_groups = models.ManyToManyField('accounts.Group', blank=True, related_name='members')
    # "Archiving" a user reuses AbstractUser's own built-in `is_active` —
    # Django's default auth backend and the stock simplejwt token view
    # already refuse to log in an inactive user, so there's no separate
    # archived flag needed here, unlike Course/Template which had to grow
    # their own is_archived. These two mirror Course.archived_by/
    # archived_at exactly — see that model's comment for why SET_NULL.
    archived_by = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    archived_at = models.DateTimeField(null=True, blank=True)
    # What this user can actually do on the dashboard (see PermissionSet's
    # own docstring and apps.core.permissions.user_can_access_tab) — SET_NULL,
    # not PROTECT: deleting a PermissionSet just leaves whoever had it with
    # no dashboard access rather than being blocked, unlike Course/Template
    # ownership where losing the reference would mean silently losing
    # track of who's responsible for real content.
    permission_set = models.ForeignKey(
        'accounts.PermissionSet', null=True, blank=True, on_delete=models.SET_NULL, related_name='users'
    )
    # The "super user" tier — full access to every tab, same as
    # is_superuser below, but REVOCABLE, and only by an is_superuser
    # account (see UserViewSet.grant_platform_admin/revoke_platform_admin).
    # Named distinctly from Django's own is_superuser specifically to
    # avoid the two being confused for each other at a glance — they are
    # NOT the same tier (see is_superuser's own comment just below).
    is_platform_admin = models.BooleanField(default=False)

    class Meta:
        ordering = ['username']

    # is_superuser is inherited from AbstractUser/PermissionsMixin, not
    # redeclared here — repurposed as the one permanently-protected
    # "super-super-user" tier (exactly one row expected: SuperSam). Never
    # exposed in UserSerializer, so it's unsettable through the API at
    # all; the only account that should ever have it is created directly
    # via a one-off shell command. UserViewSet.destroy/purge both refuse
    # to touch a row with is_superuser=True for exactly this reason.

    def __str__(self):
        return self.get_full_name() or self.username
