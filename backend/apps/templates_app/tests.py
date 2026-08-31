from django.test import TestCase

from apps.accounts.models import User
from . import services
from .models import Question, Section, Template, TemplateVersion


class TemplateVersioningTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin', password='x', role=User.Role.ADMIN)
        self.template = Template.objects.create(name='Site Safety Checklist', created_by=self.admin)

    def test_create_draft_is_idempotent(self):
        v1 = services.create_draft_version(self.template, self.admin)
        v2 = services.create_draft_version(self.template, self.admin)
        self.assertEqual(v1.pk, v2.pk)
        self.assertEqual(v1.version_number, 1)

    def test_publishing_archives_previous_version_and_clones_content_into_next_draft(self):
        draft = services.create_draft_version(self.template, self.admin)
        section = Section.objects.create(template_version=draft, title='PPE', order=0)
        Question.objects.create(
            section=section, question_type='boolean', label='Hard hat worn?', order=0,
            flag_rule={'operator': 'equals', 'value': False},
        )

        published_v1 = services.publish_version(draft, self.admin)
        self.assertEqual(published_v1.status, TemplateVersion.Status.PUBLISHED)

        draft_v2 = services.create_draft_version(self.template, self.admin)
        self.assertEqual(draft_v2.version_number, 2)
        self.assertEqual(draft_v2.sections.first().questions.first().label, 'Hard hat worn?')

        published_v2 = services.publish_version(draft_v2, self.admin)
        published_v1.refresh_from_db()
        self.assertEqual(published_v1.status, TemplateVersion.Status.ARCHIVED)
        self.assertEqual(published_v2.status, TemplateVersion.Status.PUBLISHED)

    def test_flag_rule_evaluation(self):
        draft = services.create_draft_version(self.template, self.admin)
        section = Section.objects.create(template_version=draft, title='PPE', order=0)
        question = Question.objects.create(
            section=section, question_type='boolean', label='Hard hat worn?', order=0,
            flag_rule={'operator': 'equals', 'value': False},
        )
        self.assertTrue(question.evaluate_flag(False))
        self.assertFalse(question.evaluate_flag(True))
