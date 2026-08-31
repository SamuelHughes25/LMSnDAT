from django.db import migrations

TASK_NAMES = [
    'Generate recurring assignment occurrences',
    'Mark overdue assignments',
    'Backup database',
]


def seed_periodic_tasks(apps, schema_editor):
    IntervalSchedule = apps.get_model('django_celery_beat', 'IntervalSchedule')
    CrontabSchedule = apps.get_model('django_celery_beat', 'CrontabSchedule')
    PeriodicTask = apps.get_model('django_celery_beat', 'PeriodicTask')

    every_15_min, _ = IntervalSchedule.objects.get_or_create(every=15, period='minutes')
    PeriodicTask.objects.get_or_create(
        name='Generate recurring assignment occurrences',
        defaults={
            'interval': every_15_min,
            'task': 'apps.assignments.tasks.generate_recurring_assignment_occurrences',
        },
    )

    daily_0100, _ = CrontabSchedule.objects.get_or_create(
        minute='0', hour='1', day_of_week='*', day_of_month='*', month_of_year='*',
    )
    PeriodicTask.objects.get_or_create(
        name='Mark overdue assignments',
        defaults={'crontab': daily_0100, 'task': 'apps.assignments.tasks.mark_overdue_assignments'},
    )

    daily_0300, _ = CrontabSchedule.objects.get_or_create(
        minute='0', hour='3', day_of_week='*', day_of_month='*', month_of_year='*',
    )
    PeriodicTask.objects.get_or_create(
        name='Backup database',
        defaults={'crontab': daily_0300, 'task': 'apps.core.tasks.backup_database'},
    )


def unseed_periodic_tasks(apps, schema_editor):
    PeriodicTask = apps.get_model('django_celery_beat', 'PeriodicTask')
    PeriodicTask.objects.filter(name__in=TASK_NAMES).delete()


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ('django_celery_beat', '0018_improve_crontab_helptext'),
    ]

    operations = [
        migrations.RunPython(seed_periodic_tasks, unseed_periodic_tasks),
    ]
