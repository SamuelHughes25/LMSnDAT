from django.contrib import admin

from .models import CorrectiveAction


@admin.register(CorrectiveAction)
class CorrectiveActionAdmin(admin.ModelAdmin):
    list_display = ('answer', 'owner', 'status', 'due_date')
    list_filter = ('status',)
