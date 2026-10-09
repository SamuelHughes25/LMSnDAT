from django.db import migrations
from django.db.migrations.exceptions import IrreversibleError


def merge_groups_forward(apps, schema_editor):
    """Merges CourseGroup + TemplateGroup back into one Group per distinct
    name — the split into two independent models was reverted on explicit
    correction (a group is meant to bundle BOTH courses and templates
    together, e.g. "Commercial Dwelling Engineer" carrying its own training
    courses and audit templates as one assignable unit). For any name that
    existed as both a CourseGroup and a TemplateGroup (exactly what
    migration 0005 itself produced when splitting a JobRole that had both),
    this merges them into one Group with both course and template access,
    and membership in EITHER becomes membership in the merged Group."""
    CourseGroup = apps.get_model('accounts', 'CourseGroup')
    TemplateGroup = apps.get_model('accounts', 'TemplateGroup')
    Group = apps.get_model('accounts', 'Group')

    course_groups_by_name = {cg.name: cg for cg in CourseGroup.objects.prefetch_related('courses', 'members')}
    template_groups_by_name = {tg.name: tg for tg in TemplateGroup.objects.prefetch_related('templates', 'members')}

    for name in set(course_groups_by_name) | set(template_groups_by_name):
        course_group = course_groups_by_name.get(name)
        template_group = template_groups_by_name.get(name)
        description = (course_group.description if course_group else '') or (
            template_group.description if template_group else ''
        )

        group, _ = Group.objects.get_or_create(name=name, defaults={'description': description})
        if course_group:
            group.courses.set(course_group.courses.values_list('id', flat=True))
        if template_group:
            group.templates.set(template_group.templates.values_list('id', flat=True))

        member_ids = set()
        if course_group:
            member_ids |= set(course_group.members.values_list('id', flat=True))
        if template_group:
            member_ids |= set(template_group.members.values_list('id', flat=True))
        group.members.set(member_ids)


def merge_groups_backward(apps, schema_editor):
    raise IrreversibleError(
        'Cannot reverse: a merged Group with both courses and templates cannot be split '
        'back into separate CourseGroup/TemplateGroup rows without ambiguity.'
    )


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0006_remove_user_course_groups_and_more'),
    ]

    operations = [
        migrations.RunPython(merge_groups_forward, merge_groups_backward),
        # Same relative order Django's own autodetector originally proposed
        # for removing these fields/models — preserved as-is rather than
        # guessed at, since only Django's dependency resolution actually
        # knows which order avoids FK issues between the M2M through-tables
        # and the models they reference.
        migrations.RemoveField(
            model_name='user',
            name='course_groups',
        ),
        migrations.RemoveField(
            model_name='templategroup',
            name='templates',
        ),
        migrations.RemoveField(
            model_name='user',
            name='template_groups',
        ),
        migrations.DeleteModel(
            name='CourseGroup',
        ),
        migrations.DeleteModel(
            name='TemplateGroup',
        ),
    ]
