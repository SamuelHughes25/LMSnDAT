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


class JobRole(BaseModel):
    """A job-title-based content bundle (e.g. "Gas Engineer") — deliberately
    named JobRole, not Role, to avoid colliding with User.Role below: that's
    a fixed 3-value permission enum (admin/manager/member), this is an
    admin-creatable record that determines which courses/templates get
    pushed to whoever it's assigned to. Orthogonal to Team (an org-chart
    grouping with a manager) — a user can be on "Team North" and have the
    job role "Gas Engineer" independently.

    courses/templates are plain M2M fields (not a through-model with extra
    metadata) since Phase 1 only needs "is this course part of this role's
    bundle," not who assigned it or when — a real, deliberate scope
    narrowing, not an oversight.
    """

    name = models.CharField(max_length=255, unique=True)
    description = models.TextField(blank=True)
    courses = models.ManyToManyField('courses.Course', blank=True, related_name='job_roles')
    templates = models.ManyToManyField('templates_app.Template', blank=True, related_name='job_roles')

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
    # Single job role per user for Phase 1 (a plain FK, not M2M) — matches
    # "an operative can be assigned a role" and keeps this pass simple;
    # widening to multiple roles later is a straightforward follow-up
    # migration, not a redesign.
    job_role = models.ForeignKey(
        'accounts.JobRole',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='users',
    )

    class Meta:
        ordering = ['username']

    def __str__(self):
        return self.get_full_name() or self.username
