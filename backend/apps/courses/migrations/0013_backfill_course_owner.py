from django.db import migrations
from django.db.models import F


def backfill_owner(apps, schema_editor):
    Course = apps.get_model('courses', 'Course')
    Course.objects.filter(owner__isnull=True).update(owner=F('created_by'))


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('courses', '0012_course_editors_course_owner'),
    ]

    operations = [
        migrations.RunPython(backfill_owner, noop),
    ]
