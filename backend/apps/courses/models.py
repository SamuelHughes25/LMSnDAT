from django.db import models
from django.db.models import Q

from apps.core.models import BaseModel
from .constants import AssetKind, SlideType, TransitionStyle


class Course(BaseModel):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='courses_created')
    is_archived = models.BooleanField(default=False)
    # Whole-course, not per-version (same level as is_archived) — marks this
    # course as a scored assessment rather than free-form training content.
    # passing_score is a 0-100 percentage, only meaningful when True; a
    # CourseAttempt's own `passed` stays null whenever this is False, no
    # matter what score was achieved (see CourseAttemptViewSet.complete).
    is_assessment = models.BooleanField(default=False)
    passing_score = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    @property
    def published_version(self):
        return self.versions.filter(status=CourseVersion.Status.PUBLISHED).order_by('-version_number').first()


class CourseVersion(BaseModel):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        ARCHIVED = 'archived', 'Archived'

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='versions')
    version_number = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='course_versions_created'
    )
    published_at = models.DateTimeField(null=True, blank=True)
    # Course-wide authored setting for learner-facing slide-to-slide transitions
    # in Preview mode / the future learner player. No TemplateVersion analog.
    transition_style = models.CharField(
        max_length=20, choices=TransitionStyle.choices, default=TransitionStyle.FADE
    )

    class Meta:
        ordering = ['course', '-version_number']
        constraints = [
            models.UniqueConstraint(
                fields=['course', 'version_number'], name='unique_version_number_per_course'
            ),
            # Enforced in the DB, not just the service layer: a course can
            # only ever have one draft in flight at a time.
            models.UniqueConstraint(
                fields=['course'], condition=Q(status='draft'), name='one_draft_per_course'
            ),
        ]

    def __str__(self):
        return f'{self.course.name} v{self.version_number} ({self.status})'


class Lesson(BaseModel):
    course_version = models.ForeignKey(CourseVersion, on_delete=models.CASCADE, related_name='lessons')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['course_version', 'order']

    def __str__(self):
        return self.title


class Slide(BaseModel):
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name='slides')
    slide_type = models.CharField(max_length=30, choices=SlideType.choices)
    # Canvas label for the slide in the builder — not shown to the learner.
    title = models.CharField(max_length=255, blank=True)
    order = models.PositiveIntegerField(default=0)
    # Type-specific content (body text, options, buckets/items, etc).
    config = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['lesson', 'order']

    def __str__(self):
        return self.title or f'{self.get_slide_type_display()} slide'


class CourseAttempt(BaseModel):
    """One operative's attempt at a specific, immutable CourseVersion —
    structurally mirrors apps.submissions.Submission (parent "who, which
    version, status, timestamps" record) but lives in this app since
    there's no separate assignment-gating concept for courses the way
    Submission has Assignment. score/passed are set only once, in
    CourseAttemptViewSet.complete(), computed from this attempt's own
    (server-graded — see grading.py) SlideResult rows, never trusted from
    the client.
    """

    class Status(models.TextChoices):
        IN_PROGRESS = 'in_progress', 'In progress'
        COMPLETED = 'completed', 'Completed'

    course_version = models.ForeignKey(CourseVersion, on_delete=models.PROTECT, related_name='attempts')
    user = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='course_attempts')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_PROGRESS)
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # 0-100, set on completion from this attempt's own SlideResult rows.
    score = models.PositiveSmallIntegerField(null=True, blank=True)
    # Null unless the course is an assessment AND a score was computed —
    # never set to False just because the course isn't scored.
    passed = models.BooleanField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        return f'CourseAttempt {self.id} ({self.status})'


class SlideResult(BaseModel):
    """One interactive slide's result within a CourseAttempt. `detail` is
    the ONLY thing the client ever submits — the raw, type-specific answer
    payload each slide face's present mode already sends to onInteraction
    (see frontend/src/lib/slide-interaction.ts and grading.py's own module
    docstring for the exact shape per slide_type). is_correct/score are
    NOT client-writable: save() always recomputes them server-side via
    grade_slide(), the same "derive correctness from the raw submitted
    value, never trust a client-sent flag" pattern already established by
    apps.submissions.Answer.save()'s requires_action computation. Frozen at
    whatever grading.py said at submit time — a later change to the
    grading logic doesn't retroactively alter past compliance records.
    """

    attempt = models.ForeignKey(CourseAttempt, on_delete=models.CASCADE, related_name='slide_results')
    slide = models.ForeignKey(Slide, on_delete=models.CASCADE, related_name='results')
    detail = models.JSONField(null=True, blank=True)
    is_correct = models.BooleanField(editable=False)
    score = models.FloatField(editable=False)  # 0-1 fraction

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['attempt', 'slide'], name='unique_result_per_slide_per_attempt'),
        ]

    def __str__(self):
        return f'SlideResult for slide {self.slide_id} on attempt {self.attempt_id}'

    def save(self, *args, **kwargs):
        from .grading import grade_slide

        self.is_correct, self.score = grade_slide(self.slide, self.detail)
        super().save(*args, **kwargs)


class CourseAsset(BaseModel):
    # Shared reusable media library per draft — not per-slide. Slide.config
    # stores the resulting asset URL as a plain string (e.g. config.image_url),
    # matching how Slide/Question config already store literal values rather
    # than cross-references. Known tradeoff: no DB-level orphaned-asset
    # cleanup — same style as the existing shared-bucket tradeoffs already
    # noted in docs/PROJECT_LOG.md.
    course_version = models.ForeignKey(CourseVersion, on_delete=models.CASCADE, related_name='assets')
    file = models.FileField(upload_to='course-assets/%Y/%m/')
    kind = models.CharField(max_length=20, choices=AssetKind.choices, default=AssetKind.OTHER)
    uploaded_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='course_assets_uploaded')

    def __str__(self):
        return self.file.name
