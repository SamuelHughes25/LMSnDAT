from datetime import timedelta

from celery import shared_task
from dateutil.rrule import rrulestr
from django.utils import timezone

from .models import Assignment

# How far ahead recurring occurrences are materialized. Runs frequently (see
# Celery Beat schedule) so this doesn't need to be large.
GENERATION_HORIZON = timedelta(days=7)


@shared_task
def generate_recurring_assignment_occurrences():
    now = timezone.now()
    horizon = now + GENERATION_HORIZON
    roots = Assignment.objects.filter(recurrence_rule__isnull=False)

    for root in roots:
        rule = rrulestr(root.recurrence_rule)
        upcoming = rule.between(now, horizon, inc=True)
        existing_due_dates = set(
            root.occurrences.filter(due_date__in=upcoming).values_list('due_date', flat=True)
        )
        for occurrence_date in upcoming:
            if occurrence_date in existing_due_dates:
                continue
            Assignment.objects.create(
                template_version=root.template_version,
                assigned_user=root.assigned_user,
                assigned_team=root.assigned_team,
                due_date=occurrence_date,
                recurrence_parent=root,
                created_by=root.created_by,
            )


@shared_task
def mark_overdue_assignments():
    now = timezone.now()
    Assignment.objects.filter(
        due_date__lt=now,
        status__in=[Assignment.Status.PENDING, Assignment.Status.IN_PROGRESS],
    ).update(status=Assignment.Status.OVERDUE)
