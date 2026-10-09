from django.db import transaction
from django.utils import timezone

from .models import CourseVersion, Lesson, ReusableLesson, ReusableSlide, Slide


@transaction.atomic
def create_draft_version(course, user):
    """Returns the course's current draft, creating one (cloned from the
    latest version) if none exists. Never creates a second draft."""
    existing_draft = course.versions.filter(status=CourseVersion.Status.DRAFT).first()
    if existing_draft:
        return existing_draft

    last_version = course.versions.order_by('-version_number').first()
    new_version_kwargs = dict(
        course=course,
        version_number=(last_version.version_number + 1 if last_version else 1),
        status=CourseVersion.Status.DRAFT,
        created_by=user,
    )
    if last_version:
        # Carry the authored transition setting forward, same as the cloned
        # lesson/slide content — it's a course-wide setting, not per-version.
        new_version_kwargs['transition_style'] = last_version.transition_style
    new_version = CourseVersion.objects.create(**new_version_kwargs)

    if last_version:
        _clone_lessons(last_version, new_version)

    return new_version


def _clone_lessons(source_version, target_version):
    for lesson in source_version.lessons.prefetch_related('slides'):
        new_lesson = Lesson.objects.create(
            course_version=target_version,
            title=lesson.title,
            description=lesson.description,
            order=lesson.order,
        )
        Slide.objects.bulk_create(
            Slide(
                lesson=new_lesson,
                slide_type=s.slide_type,
                title=s.title,
                order=s.order,
                config=s.config,
            )
            for s in lesson.slides.all()
        )


@transaction.atomic
def save_lesson_as_reusable(lesson, name, description, user):
    """Clones `lesson`'s slides into a brand new, standalone ReusableLesson
    library entry — same bulk_create-from-a-snapshot shape as
    _clone_lessons above, just landing in ReusableSlide instead of Slide.
    The source `lesson` is left completely untouched; nothing here links
    back to it (see ReusableLesson's own docstring for why)."""
    reusable_lesson = ReusableLesson.objects.create(name=name, description=description, created_by=user)
    ReusableSlide.objects.bulk_create(
        ReusableSlide(
            reusable_lesson=reusable_lesson,
            slide_type=s.slide_type,
            title=s.title,
            order=s.order,
            config=s.config,
        )
        for s in lesson.slides.all()
    )
    return reusable_lesson


@transaction.atomic
def import_reusable_lesson(reusable_lesson, target_version, order):
    """The inverse of save_lesson_as_reusable above: clones a ReusableLesson's
    slides into a brand new real Lesson on `target_version`. A one-time
    copy, not a live link — the new Lesson has no ongoing relationship to
    `reusable_lesson` afterward, so editing either one later never affects
    the other (confirmed product decision: avoids the much larger "shared
    ownership" problem a live link would introduce)."""
    new_lesson = Lesson.objects.create(
        course_version=target_version,
        title=reusable_lesson.name,
        description=reusable_lesson.description,
        order=order,
    )
    Slide.objects.bulk_create(
        Slide(
            lesson=new_lesson,
            slide_type=s.slide_type,
            title=s.title,
            order=s.order,
            config=s.config,
        )
        for s in reusable_lesson.slides.all()
    )
    return new_lesson


@transaction.atomic
def publish_version(version, user):
    if version.status != CourseVersion.Status.DRAFT:
        raise ValueError('Only draft versions can be published.')

    CourseVersion.objects.filter(
        course=version.course,
        status=CourseVersion.Status.PUBLISHED,
    ).update(status=CourseVersion.Status.ARCHIVED)

    version.status = CourseVersion.Status.PUBLISHED
    version.published_at = timezone.now()
    version.save(update_fields=['status', 'published_at'])
    return version
