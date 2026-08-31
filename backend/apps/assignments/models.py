from django.db import models
from django.db.models import Q

from apps.core.models import BaseModel


class Assignment(BaseModel):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        IN_PROGRESS = 'in_progress', 'In progress'
        COMPLETE = 'complete', 'Complete'
        OVERDUE = 'overdue', 'Overdue'

    template_version = models.ForeignKey(
        'templates_app.TemplateVersion', on_delete=models.PROTECT, related_name='assignments'
    )
    assigned_user = models.ForeignKey(
        'accounts.User', null=True, blank=True, on_delete=models.CASCADE, related_name='assignments'
    )
    assigned_team = models.ForeignKey(
        'accounts.Team', null=True, blank=True, on_delete=models.CASCADE, related_name='assignments'
    )
    due_date = models.DateTimeField()
    # RFC 5545 RRULE string (e.g. "DTSTART:20260901T090000Z\nFREQ=WEEKLY;BYDAY=MO"),
    # set only on the recurrence "root" assignment. Celery Beat generates concrete
    # occurrence Assignments from it — see tasks.generate_recurring_assignment_occurrences.
    recurrence_rule = models.TextField(null=True, blank=True)
    recurrence_parent = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.CASCADE, related_name='occurrences'
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='assignments_created')

    class Meta:
        ordering = ['due_date']
        constraints = [
            models.CheckConstraint(
                check=(
                    Q(assigned_user__isnull=False, assigned_team__isnull=True)
                    | Q(assigned_user__isnull=True, assigned_team__isnull=False)
                ),
                name='assignment_target_exactly_one',
            ),
        ]

    def __str__(self):
        target = self.assigned_user or self.assigned_team
        return f'{self.template_version.template.name} -> {target}'
