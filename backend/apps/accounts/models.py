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

    class Meta:
        ordering = ['username']

    def __str__(self):
        return self.get_full_name() or self.username
