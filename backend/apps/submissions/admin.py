from django.contrib import admin

from .models import Answer, Attachment, Submission


@admin.register(Submission)
class SubmissionAdmin(admin.ModelAdmin):
    list_display = ('id', 'template_version', 'submitted_by', 'status', 'submitted_at')
    list_filter = ('status',)


@admin.register(Answer)
class AnswerAdmin(admin.ModelAdmin):
    list_display = ('question', 'submission', 'requires_action')
    list_filter = ('requires_action',)


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ('file', 'answer', 'kind', 'uploaded_by')
