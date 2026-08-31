from django.contrib import admin

from .models import Assignment


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ('template_version', 'assigned_user', 'assigned_team', 'due_date', 'status')
    list_filter = ('status',)
