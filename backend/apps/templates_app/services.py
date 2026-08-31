from django.db import transaction
from django.utils import timezone

from .models import Question, Section, TemplateVersion


@transaction.atomic
def create_draft_version(template, user):
    """Returns the template's current draft, creating one (cloned from the
    latest version) if none exists. Never creates a second draft."""
    existing_draft = template.versions.filter(status=TemplateVersion.Status.DRAFT).first()
    if existing_draft:
        return existing_draft

    last_version = template.versions.order_by('-version_number').first()
    new_version = TemplateVersion.objects.create(
        template=template,
        version_number=(last_version.version_number + 1 if last_version else 1),
        status=TemplateVersion.Status.DRAFT,
        created_by=user,
    )

    if last_version:
        _clone_sections(last_version, new_version)

    return new_version


def _clone_sections(source_version, target_version):
    for section in source_version.sections.prefetch_related('questions'):
        new_section = Section.objects.create(
            template_version=target_version,
            title=section.title,
            description=section.description,
            order=section.order,
        )
        Question.objects.bulk_create(
            Question(
                section=new_section,
                question_type=q.question_type,
                label=q.label,
                help_text=q.help_text,
                order=q.order,
                is_required=q.is_required,
                config=q.config,
                display_logic=q.display_logic,
                flag_rule=q.flag_rule,
            )
            for q in section.questions.all()
        )


@transaction.atomic
def publish_version(version, user):
    if version.status != TemplateVersion.Status.DRAFT:
        raise ValueError('Only draft versions can be published.')

    TemplateVersion.objects.filter(
        template=version.template,
        status=TemplateVersion.Status.PUBLISHED,
    ).update(status=TemplateVersion.Status.ARCHIVED)

    version.status = TemplateVersion.Status.PUBLISHED
    version.published_at = timezone.now()
    version.save(update_fields=['status', 'published_at'])
    return version
