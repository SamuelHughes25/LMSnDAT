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

    class Meta:
        ordering = ['username']

    def __str__(self):
        return self.get_full_name() or self.username
