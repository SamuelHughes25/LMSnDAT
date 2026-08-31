from django.db import models

from apps.core.models import BaseModel


class Submission(BaseModel):
    class Status(models.TextChoices):
        IN_PROGRESS = 'in_progress', 'In progress'
        SUBMITTED = 'submitted', 'Submitted'

    assignment = models.ForeignKey('assignments.Assignment', on_delete=models.PROTECT, related_name='submissions')
    # Denormalized on purpose: copied from assignment.template_version at
    # creation time so a submission's answers always resolve against the
    # exact version they were filled out on, even if the assignment record
    # changes later.
    template_version = models.ForeignKey(
        'templates_app.TemplateVersion', on_delete=models.PROTECT, related_name='submissions'
    )
    submitted_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='submissions')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_PROGRESS)
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        return f'Submission {self.id} ({self.status})'


class Answer(BaseModel):
    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, related_name='answers')
    question = models.ForeignKey('templates_app.Question', on_delete=models.PROTECT, related_name='answers')
    value = models.JSONField(null=True, blank=True)
    requires_action = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['submission', 'question'], name='unique_answer_per_question'),
        ]

    def __str__(self):
        return f'Answer to {self.question_id} on {self.submission_id}'

    def save(self, *args, **kwargs):
        self.requires_action = self.question.evaluate_flag(self.value)
        super().save(*args, **kwargs)


class Attachment(BaseModel):
    class Kind(models.TextChoices):
        PHOTO = 'photo', 'Photo'
        SIGNATURE = 'signature', 'Signature'
        OTHER = 'other', 'Other'

    answer = models.ForeignKey(Answer, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to='attachments/%Y/%m/')
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.OTHER)
    uploaded_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='attachments_uploaded')

    def __str__(self):
        return self.file.name
