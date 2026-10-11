from django.db import migrations
from django.db.models import F


def backfill_owner(apps, schema_editor):
    Template = apps.get_model('templates_app', 'Template')
    Template.objects.filter(owner__isnull=True).update(owner=F('created_by'))


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('templates_app', '0003_template_editors_template_owner'),
    ]

    operations = [
        migrations.RunPython(backfill_owner, noop),
    ]
