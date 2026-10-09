from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import Group, Team, User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    fieldsets = DjangoUserAdmin.fieldsets + (
        ('LMS', {'fields': ('role', 'team', 'content_groups')}),
    )
    # list_display can't render M2M fields (content_groups) at all —
    # Django raises on it.
    list_display = ('username', 'email', 'role', 'team', 'is_staff')
    filter_horizontal = DjangoUserAdmin.filter_horizontal + ('content_groups',)


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ('name', 'manager', 'created_at')
    search_fields = ('name',)


@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    list_display = ('name', 'created_at')
    search_fields = ('name',)
    filter_horizontal = ('courses', 'templates')
