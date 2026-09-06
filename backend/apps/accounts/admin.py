from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import JobRole, Team, User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    fieldsets = DjangoUserAdmin.fieldsets + (
        ('LMS', {'fields': ('role', 'team', 'job_role')}),
    )
    list_display = ('username', 'email', 'role', 'team', 'job_role', 'is_staff')


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ('name', 'manager', 'created_at')
    search_fields = ('name',)


@admin.register(JobRole)
class JobRoleAdmin(admin.ModelAdmin):
    list_display = ('name', 'created_at')
    search_fields = ('name',)
    filter_horizontal = ('courses', 'templates')
