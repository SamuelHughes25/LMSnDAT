from django.db import migrations


# One-time backfill for every course that already existed when
# CourseContentRole was introduced — see that model's own docstring. From
# here on, transfer_ownership/set_editors (apps/courses/views.py) keep this
# table current as ownership/editor membership actually changes; this
# migration only ever needs to capture each course's CURRENT state once.
def backfill_content_roles(apps, schema_editor):
    Course = apps.get_model('courses', 'Course')
    CourseContentRole = apps.get_model('courses', 'CourseContentRole')
    rows = []
    for course in Course.objects.all().prefetch_related('editors'):
        if course.owner_id is not None:
            rows.append(CourseContentRole(course_id=course.id, user_id=course.owner_id))
        for editor_id in course.editors.values_list('id', flat=True):
            rows.append(CourseContentRole(course_id=course.id, user_id=editor_id))
    CourseContentRole.objects.bulk_create(rows, ignore_conflicts=True)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('courses', '0022_coursecontentrole_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_content_roles, noop),
    ]
