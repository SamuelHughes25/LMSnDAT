from django.db import transaction
from django.utils import timezone

from .models import CourseVersion, Lesson, ReusableLesson, ReusableSlide, Slide, SlideTemplate


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
    reusable_lesson = ReusableLesson.objects.create(
        name=name, description=description, order=ReusableLesson.objects.count(), created_by=user
    )
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


def save_slide_as_template(slide, name, user):
    """Clones `slide`'s own slide_type and config into a brand new,
    standalone SlideTemplate library entry — the one-slide analogue of
    save_lesson_as_reusable above. Works for any slide_type, not just
    freeform `content` — an assessment slide's config carries its own
    correct answer inline (see SlideTemplate's own docstring), so cloning
    it here is exactly as sufficient as cloning a ReusableSlide's config
    already is. The source `slide` is left completely untouched; nothing
    here links back to it."""
    return SlideTemplate.objects.create(
        name=name, slide_type=slide.slide_type, config=slide.config,
        order=SlideTemplate.objects.count(), created_by=user,
    )


def import_slide_template(slide_template, lesson, order):
    """The inverse of save_slide_as_template above: clones a SlideTemplate's
    slide_type and config into a brand new real Slide on `lesson`. A
    one-time copy, not a live link, same reasoning as
    import_reusable_lesson's own identical note. Deliberately touches only
    `lesson`'s own Slide — never the target Course/CourseVersion itself —
    so importing a template built from an assessment-course's slide can
    never make the TARGET course's own `is_assessment`/`passing_score`
    change; those stay exactly whatever the target course's own settings
    already say, regardless of what kind of slide just got imported into
    it."""
    return Slide.objects.create(
        lesson=lesson,
        slide_type=slide_template.slide_type,
        title=slide_template.name,
        order=order,
        config=slide_template.config,
    )


@transaction.atomic
def revert_to_version(source_version, user):
    """Starts a new, unpublished draft cloned from `source_version`'s own
    lessons/slides — the version-history tab's "revert to this version"
    action. Deliberately NOT a variant of create_draft_version above: that
    function always clones from the course's latest version and silently
    reuses an existing draft if one's already open; reverting needs to
    clone from an arbitrary (often much older) version instead, and must
    NOT silently fold into — or overwrite — a draft the author might
    already be partway through, so it refuses outright if one exists
    rather than guessing which content should win.
    """
    course = source_version.course
    if course.versions.filter(status=CourseVersion.Status.DRAFT).exists():
        raise ValueError(
            'This course already has an unpublished draft in progress. '
            'Publish or delete it before reverting to an older version.'
        )

    # last_version always exists here — source_version is itself one of
    # course.versions, so this can never be None the way
    # create_draft_version's own lookup can be for a brand new course.
    last_version = course.versions.order_by('-version_number').first()
    new_version = CourseVersion.objects.create(
        course=course,
        version_number=last_version.version_number + 1,
        status=CourseVersion.Status.DRAFT,
        created_by=user,
        transition_style=source_version.transition_style,
    )
    _clone_lessons(source_version, new_version)
    return new_version


@transaction.atomic
def publish_version(version, user):
    if version.status != CourseVersion.Status.DRAFT:
        raise ValueError('Only draft versions can be published.')

    # A published course with zero slides is a dead end for whoever it
    # gets assigned to — the portal player would show "This course
    # doesn't have any content yet" (see course-preview-viewer.tsx) with
    # nothing to do and no way to ever complete it, a stuck/confusing
    # state for a non-use-case nobody should be able to reach in the
    # first place. Checked here (not just the frontend's own Publish
    # button) so this can't be bypassed by posting straight to this
    # action either.
    if not Slide.objects.filter(lesson__course_version=version).exists():
        raise ValueError('Add at least one slide before publishing this course.')

    CourseVersion.objects.filter(
        course=version.course,
        status=CourseVersion.Status.PUBLISHED,
    ).update(status=CourseVersion.Status.ARCHIVED)

    version.status = CourseVersion.Status.PUBLISHED
    version.published_at = timezone.now()
    version.save(update_fields=['status', 'published_at'])
    return version
