from django.db import models
from django.db.models import Q

from apps.core.models import BaseModel
from .constants import QuestionType


class Template(BaseModel):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    # Mirrors Course.created_by exactly (SET_NULL, not PROTECT) — see that
    # model's comment.
    created_by = models.ForeignKey(
        'accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='templates_created'
    )
    # Mirrors Course.owner/editors exactly — see that model's comments.
    owner = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='templates_owned')
    editors = models.ManyToManyField('accounts.User', blank=True, related_name='templates_editing')
    is_archived = models.BooleanField(default=False)
    # Mirrors Course.archived_by/archived_at exactly — see that model's
    # comment for why SET_NULL, not PROTECT.
    archived_by = models.ForeignKey(
        'accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        # Mirrors Course.save's identical fallback — see its comment.
        if self.owner_id is None and self.created_by_id is not None:
            self.owner_id = self.created_by_id
        super().save(*args, **kwargs)

    @property
    def published_version(self):
        return self.versions.filter(status=TemplateVersion.Status.PUBLISHED).order_by('-version_number').first()


class TemplateVersion(BaseModel):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        ARCHIVED = 'archived', 'Archived'

    template = models.ForeignKey(Template, on_delete=models.CASCADE, related_name='versions')
    version_number = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='template_versions_created'
    )
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['template', '-version_number']
        constraints = [
            models.UniqueConstraint(
                fields=['template', 'version_number'], name='unique_version_number_per_template'
            ),
            # Enforced in the DB, not just the service layer: a template can
            # only ever have one draft in flight at a time.
            models.UniqueConstraint(
                fields=['template'], condition=Q(status='draft'), name='one_draft_per_template'
            ),
        ]

    def __str__(self):
        return f'{self.template.name} v{self.version_number} ({self.status})'


class Section(BaseModel):
    template_version = models.ForeignKey(TemplateVersion, on_delete=models.CASCADE, related_name='sections')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['template_version', 'order']

    def __str__(self):
        return self.title


class Question(BaseModel):
    section = models.ForeignKey(Section, on_delete=models.CASCADE, related_name='questions')
    question_type = models.CharField(max_length=30, choices=QuestionType.choices)
    label = models.CharField(max_length=500)
    help_text = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)
    is_required = models.BooleanField(default=False)

    # Type-specific settings (select options, number bounds, etc).
    config = models.JSONField(default=dict, blank=True)
    # {"question_id": "<uuid>", "operator": "equals", "value": ...} — show this
    # question only if the referenced question's answer matches.
    display_logic = models.JSONField(null=True, blank=True)
    # {"operator": "equals" | "not_equals" | "in", "value": ...} — marks an
    # Answer as requires_action, which is what drives Corrective Actions in MVP.
    # Full weighted scoring is deferred to phase 2 — see docs/PROJECT_LOG.md.
    flag_rule = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ['section', 'order']

    def __str__(self):
        return self.label

    def evaluate_flag(self, value):
        if not self.flag_rule:
            return False
        operator = self.flag_rule.get('operator', 'equals')
        trigger = self.flag_rule.get('value')
        if operator == 'equals':
            return value == trigger
        if operator == 'not_equals':
            return value != trigger
        if operator == 'in':
            return value in (trigger or [])
        return False
