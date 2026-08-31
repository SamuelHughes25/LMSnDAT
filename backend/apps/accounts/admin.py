from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import Team, User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    fieldsets = DjangoUserAdmin.fieldsets + (
        ('LMS', {'fields': ('role', 'team')}),
    )
    list_display = ('username', 'email', 'role', 'team', 'is_staff')


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ('name', 'manager', 'created_at')
    search_fields = ('name',)
