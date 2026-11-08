"""Keeps CourseAccessGrant stamped the moment a user gains access to a
course through any of its three paths — see that model's own docstring for
why this has to happen automatically, everywhere access can be granted,
rather than being set by hand at each call site (which risks silently
missing one). Registered in CoursesConfig.ready().
"""
from django.db.models.signals import m2m_changed, post_save
from django.dispatch import receiver

from apps.accounts.models import Group, User
from .models import CourseAccessGrant, CourseAssignment


def _grant(user, course):
    CourseAccessGrant.objects.get_or_create(user=user, course=course)


@receiver(post_save, sender=CourseAssignment)
def on_course_assignment_created(sender, instance, created, **kwargs):
    if created:
        _grant(instance.user, instance.course)


@receiver(m2m_changed, sender=User.content_groups.through)
def on_user_groups_changed(sender, instance, action, pk_set, reverse, **kwargs):
    # Fires both when a USER is added to Group(s) (the normal path — see
    # UserSerializer.update's `user.content_groups.set(...)`) and, in
    # principle, when a GROUP gains member(s) from its own reverse side —
    # handled either way since nothing in this app guarantees only one
    # direction is ever used.
    if action != 'post_add' or not pk_set:
        return
    if not reverse:
        # instance: User: pk_set: ids of Groups just added to them.
        for group in Group.objects.filter(pk__in=pk_set).prefetch_related('courses'):
            for course in group.courses.all():
                _grant(instance, course)
    else:
        # instance: Group; pk_set: ids of Users just added to it.
        courses = list(instance.courses.all())
        if not courses:
            return
        for user in User.objects.filter(pk__in=pk_set):
            for course in courses:
                _grant(user, course)


@receiver(m2m_changed, sender=Group.courses.through)
def on_group_courses_changed(sender, instance, action, pk_set, reverse, **kwargs):
    # Fires when a COURSE is added to Group(s) (the normal path — see
    # GroupSerializer's default M2M handling of `courses`) and, in
    # principle, from the course's own reverse side (`course.groups.add`).
    if action != 'post_add' or not pk_set:
        return
    if not reverse:
        # instance: Group; pk_set: ids of Courses just added to it.
        members = list(instance.members.all())
        if not members:
            return
        from .models import Course
        for course in Course.objects.filter(pk__in=pk_set):
            for user in members:
                _grant(user, course)
    else:
        # instance: Course; pk_set: ids of Groups it was just added to.
        for group in Group.objects.filter(pk__in=pk_set).prefetch_related('members'):
            for user in group.members.all():
                _grant(user, instance)
