from django.db import models
from django.db.models import Q

from apps.core.models import BaseModel
from .constants import AssetKind, SlideType, TransitionStyle


class Course(BaseModel):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='courses_created')
    is_archived = models.BooleanField(default=False)

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
