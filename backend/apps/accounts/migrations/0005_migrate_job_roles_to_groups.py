from django.db import migrations
from django.db.migrations.exceptions import IrreversibleError


def migrate_job_roles_forward(apps, schema_editor):
    """For every existing JobRole: create a CourseGroup with the same
    name/description if it has any courses, and/or a TemplateGroup the same
    way if it has any templates (a role with both creates both — they're
    independent from here on, sharing only the display name they inherited
    from the role they were split out of). Every user who had that JobRole
    becomes a member of whichever of the two were actually created for it.
    """
    JobRole = apps.get_model('accounts', 'JobRole')
    CourseGroup = apps.get_model('accounts', 'CourseGroup')
    TemplateGroup = apps.get_model('accounts', 'TemplateGroup')
    User = apps.get_model('accounts', 'User')

    for role in JobRole.objects.prefetch_related('courses', 'templates', 'users'):
        course_ids = list(role.courses.values_list('id', flat=True))
        template_ids = list(role.templates.values_list('id', flat=True))
        users = list(role.users.all())

        if course_ids:
            course_group, _ = CourseGroup.objects.get_or_create(
                name=role.name, defaults={'description': role.description}
            )
            course_group.courses.set(course_ids)
            for user in users:
                user.course_groups.add(course_group)

        if template_ids:
            template_group, _ = TemplateGroup.objects.get_or_create(
                name=role.name, defaults={'description': role.description}
            )
            template_group.templates.set(template_ids)
            for user in users:
                user.template_groups.add(template_group)


def migrate_job_roles_backward(apps, schema_editor):
    # Irreversible in any meaningful sense (a user's multiple groups can't
    # be collapsed back into a single job_role FK without picking a
    # winner) — raising is the honest answer, matching Django's own
    # convention for migrations with no sane reverse.
    raise IrreversibleError(
        'Cannot reverse: users may now belong to multiple course/template groups, '
        'which cannot be collapsed back into a single job_role FK.'
    )


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0004_remove_user_job_role_coursegroup_user_course_groups_and_more'),
    ]

    operations = [
        migrations.RunPython(migrate_job_roles_forward, migrate_job_roles_backward),
        migrations.RemoveField(
            model_name='user',
            name='job_role',
        ),
        migrations.DeleteModel(
            name='JobRole',
        ),
    ]
