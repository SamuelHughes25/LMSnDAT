from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import PermissionSet, User
from apps.assignments.models import Assignment
from apps.core.test_utils import APIAuthTestCase
from apps.submissions.models import Answer, Submission
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


class TemplateArchiveTests(APIAuthTestCase):
    """Mirrors CourseArchiveTests exactly (apps/courses/tests.py) — DELETE
    archives, `purge` is the only real hard delete and requires archiving
    first, and purging explicitly clears Answer/Submission/Assignment rows
    that would otherwise PROTECT-block deleting the Template."""

    def setUp(self):
        # is_platform_admin, not a narrow PermissionSet — needs both
        # 'archive' (destroy/restore/purge) and 'templates' (this suite
        # also lists /templates/ directly), same reasoning as
        # CourseArchiveTests.setUp in apps/courses/tests.py.
        self.admin = User.objects.create_user(username='tar_admin', password='pw', is_platform_admin=True)
        self.member = User.objects.create_user(username='tar_member', password='pw', role=User.Role.MEMBER)
        self.template = Template.objects.create(name='Archive Me', created_by=self.admin)

    def test_delete_archives_instead_of_deleting(self):
        admin_client = self.auth('tar_admin', 'pw')
        resp = admin_client.delete(f'/api/v1/templates/{self.template.id}/')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.template.refresh_from_db()
        self.assertTrue(self.template.is_archived)
        self.assertEqual(self.template.archived_by_id, self.admin.id)

    def test_archived_template_is_excluded_from_the_default_list(self):
        admin_client = self.auth('tar_admin', 'pw')
        admin_client.delete(f'/api/v1/templates/{self.template.id}/')
        resp = admin_client.get('/api/v1/templates/')
        self.assertNotIn(str(self.template.id), [t['id'] for t in resp.data['results']])
        resp = admin_client.get('/api/v1/templates/?archived=true')
        self.assertIn(str(self.template.id), [t['id'] for t in resp.data['results']])

    def test_restore_brings_it_back(self):
        admin_client = self.auth('tar_admin', 'pw')
        admin_client.delete(f'/api/v1/templates/{self.template.id}/')
        resp = admin_client.post(f'/api/v1/templates/{self.template.id}/restore/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.template.refresh_from_db()
        self.assertFalse(self.template.is_archived)
        self.assertIsNone(self.template.archived_by_id)

    def test_purge_requires_archiving_first(self):
        admin_client = self.auth('tar_admin', 'pw')
        resp = admin_client.post(f'/api/v1/templates/{self.template.id}/purge/')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertTrue(Template.objects.filter(id=self.template.id).exists())

    def test_purge_deletes_the_template_and_purges_submission_history(self):
        version = TemplateVersion.objects.create(template=self.template, version_number=1, created_by=self.admin)
        section = Section.objects.create(template_version=version, title='PPE', order=0)
        question = Question.objects.create(section=section, question_type='boolean', label='Hard hat worn?', order=0)
        assignment = Assignment.objects.create(
            template_version=version, assigned_user=self.member, due_date=timezone.now(), created_by=self.admin,
        )
        submission = Submission.objects.create(
            assignment=assignment, template_version=version, submitted_by=self.member,
        )
        Answer.objects.create(submission=submission, question=question, value=True)

        admin_client = self.auth('tar_admin', 'pw')
        admin_client.delete(f'/api/v1/templates/{self.template.id}/')
        resp = admin_client.post(f'/api/v1/templates/{self.template.id}/purge/')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(Template.objects.filter(id=self.template.id).exists())
        self.assertFalse(Submission.objects.filter(id=submission.id).exists())
        self.assertFalse(Assignment.objects.filter(id=assignment.id).exists())

    def test_member_cannot_archive_restore_or_purge(self):
        member_client = self.auth('tar_member', 'pw')
        self.assertEqual(member_client.delete(f'/api/v1/templates/{self.template.id}/').status_code, 403)
        self.assertEqual(member_client.post(f'/api/v1/templates/{self.template.id}/restore/').status_code, 403)
        self.assertEqual(member_client.post(f'/api/v1/templates/{self.template.id}/purge/').status_code, 403)


class TemplateOwnerArchivePermissionTests(APIAuthTestCase):
    """Mirrors CourseOwnerArchivePermissionTests exactly (apps/courses/
    tests.py) — HasArchiveTabAccessOrIsOwner lets a template's own owner
    archive/restore/purge it even with no Archive tab granted."""

    def setUp(self):
        # role=ADMIN explicitly — see CourseOwnerArchivePermissionTests'
        # identical comment on why leaving it at its MEMBER default would
        # silently test the wrong scenario now that the owner bypass is
        # walled off from operatives.
        no_archive = PermissionSet.objects.create(
            name='No Archive', can_access_courses=True, can_access_templates=True,
        )
        self.owner = User.objects.create_user(
            username='toap_owner', password='pw', role=User.Role.ADMIN, permission_set=no_archive,
        )
        self.other = User.objects.create_user(
            username='toap_other', password='pw', role=User.Role.ADMIN, permission_set=no_archive,
        )
        self.template = Template.objects.create(name='Owner Archive Test', created_by=self.owner, owner=self.owner)

    def test_owner_without_archive_tab_can_still_archive_their_own_template(self):
        client = self.auth('toap_owner', 'pw')
        resp = client.delete(f'/api/v1/templates/{self.template.id}/')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.template.refresh_from_db()
        self.assertTrue(self.template.is_archived)

    def test_non_owner_without_archive_tab_still_blocked(self):
        client = self.auth('toap_other', 'pw')
        resp = client.delete(f'/api/v1/templates/{self.template.id}/')
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_owner_without_archive_tab_can_restore_their_own_template(self):
        self.template.is_archived = True
        self.template.save(update_fields=['is_archived'])
        client = self.auth('toap_owner', 'pw')
        resp = client.post(f'/api/v1/templates/{self.template.id}/restore/')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_owner_without_archive_tab_can_purge_their_own_template(self):
        self.template.is_archived = True
        self.template.save(update_fields=['is_archived'])
        client = self.auth('toap_owner', 'pw')
        resp = client.post(f'/api/v1/templates/{self.template.id}/purge/')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(Template.objects.filter(id=self.template.id).exists())

    def test_non_owner_without_archive_tab_cannot_purge(self):
        self.template.is_archived = True
        self.template.save(update_fields=['is_archived'])
        client = self.auth('toap_other', 'pw')
        resp = client.post(f'/api/v1/templates/{self.template.id}/purge/')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertTrue(Template.objects.filter(id=self.template.id).exists())


class TemplateOwnershipTests(APIAuthTestCase):
    """Mirrors CourseOwnershipTests exactly (apps/courses/tests.py) —
    Template.owner/editors open up real editing rights without the global
    admin role, scoped to one specific template."""

    def setUp(self):
        self.admin = User.objects.create_user(username='town_admin', password='pw', role=User.Role.ADMIN)
        self.owner = User.objects.create_user(username='town_owner', password='pw', role=User.Role.MANAGER)
        self.editor = User.objects.create_user(username='town_editor', password='pw', role=User.Role.MANAGER)
        self.outsider = User.objects.create_user(username='town_outsider', password='pw', role=User.Role.MANAGER)
        self.template = Template.objects.create(name='Owned Template', created_by=self.admin, owner=self.owner)
        self.template.editors.add(self.editor)
        self.version = TemplateVersion.objects.create(template=self.template, version_number=1, created_by=self.admin)

    def test_editor_can_edit_template_fields_and_create_section_and_question(self):
        editor_client = self.auth('town_editor', 'pw')
        resp = editor_client.patch(f'/api/v1/templates/{self.template.id}/', {'name': 'Renamed'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

        resp = editor_client.post(
            '/api/v1/sections/',
            {'template_version': str(self.version.id), 'title': 'S1', 'description': '', 'order': 0},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        section_id = resp.data['id']

        resp = editor_client.post(
            '/api/v1/questions/',
            {'section': section_id, 'question_type': 'text', 'label': 'Q1', 'order': 0},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_outsider_manager_is_blocked(self):
        outsider_client = self.auth('town_outsider', 'pw')
        resp = outsider_client.patch(f'/api/v1/templates/{self.template.id}/', {'name': 'Renamed'}, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_only_the_super_super_user_can_transfer_ownership(self):
        # Mirrors CourseOwnershipTests' identical test exactly — see its
        # own comment for why this was tightened from owner-or-admin down
        # to is_superuser only.
        editor_client = self.auth('town_editor', 'pw')
        resp = editor_client.post(
            f'/api/v1/templates/{self.template.id}/transfer-ownership/', {'owner': self.editor.id}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)

        owner_client = self.auth('town_owner', 'pw')
        resp = owner_client.post(
            f'/api/v1/templates/{self.template.id}/transfer-ownership/', {'owner': self.editor.id}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)
        self.template.refresh_from_db()
        self.assertEqual(self.template.owner_id, self.owner.id)

        superuser = User.objects.create_user(username='town_superuser', password='pw', is_superuser=True)
        superuser_client = self.auth('town_superuser', 'pw')
        resp = superuser_client.post(
            f'/api/v1/templates/{self.template.id}/transfer-ownership/', {'owner': self.editor.id}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.template.refresh_from_db()
        self.assertEqual(self.template.owner_id, self.editor.id)

    def test_only_owner_or_admin_can_set_editors(self):
        editor_client = self.auth('town_editor', 'pw')
        resp = editor_client.post(
            f'/api/v1/templates/{self.template.id}/set-editors/', {'editors': [self.outsider.id]}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)

        owner_client = self.auth('town_owner', 'pw')
        resp = owner_client.post(
            f'/api/v1/templates/{self.template.id}/set-editors/', {'editors': [self.outsider.id]}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(set(self.template.editors.values_list('id', flat=True)), {self.outsider.id})
