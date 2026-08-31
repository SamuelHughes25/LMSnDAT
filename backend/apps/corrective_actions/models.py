from django.db import models

from apps.core.models import BaseModel


class CorrectiveAction(BaseModel):
    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        IN_PROGRESS = 'in_progress', 'In progress'
        RESOLVED = 'resolved', 'Resolved'

    answer = models.ForeignKey('submissions.Answer', on_delete=models.CASCADE, related_name='corrective_actions')
    owner = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='corrective_actions_owned')
    description = models.TextField()
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    created_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='corrective_actions_created'
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'CorrectiveAction {self.id} ({self.status})'
