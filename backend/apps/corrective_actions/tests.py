from django.utils import timezone

from apps.accounts.models import Team, User
from apps.assignments.models import Assignment
from apps.core.test_utils import APIAuthTestCase
from apps.submissions.models import Answer, Submission
from apps.templates_app import services
from apps.templates_app.models import Question, Section, Template
from .models import CorrectiveAction


class CorrectiveActionScopingTests(APIAuthTestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin', password='pw', role=User.Role.ADMIN)
        self.team_a = Team.objects.create(name='Team A')
        self.team_b = Team.objects.create(name='Team B')
        self.manager_a = User.objects.create_user(
            username='manager_a', password='pw', role=User.Role.MANAGER, team=self.team_a
        )
        self.member_b = User.objects.create_user(
            username='member_b', password='pw', role=User.Role.MEMBER, team=self.team_b
        )

        template = Template.objects.create(name='Checklist', created_by=self.admin)
        draft = services.create_draft_version(template, self.admin)
        section = Section.objects.create(template_version=draft, title='Section', order=0)
        question = Question.objects.create(
            section=section, question_type='boolean', label='OK?', order=0,
            flag_rule={'operator': 'equals', 'value': False},
        )
        version = services.publish_version(draft, self.admin)

        assignment = Assignment.objects.create(
            template_version=version, assigned_user=self.member_b, due_date=timezone.now(), created_by=self.admin,
        )
        submission = Submission.objects.create(
            assignment=assignment, template_version=version, submitted_by=self.member_b,
        )
        self.answer = Answer.objects.create(submission=submission, question=question, value=False)

    def test_manager_cannot_see_other_teams_corrective_actions(self):
        CorrectiveAction.objects.create(
            answer=self.answer, owner=self.member_b, description='Fix it', created_by=self.admin,
        )

        manager_client = self.auth('manager_a', 'pw')
        resp = manager_client.get('/api/v1/corrective-actions/')
        self.assertEqual(resp.data['count'], 0)

        admin_client = self.auth('admin', 'pw')
        resp = admin_client.get('/api/v1/corrective-actions/')
        self.assertEqual(resp.data['count'], 1)

    def test_resolving_sets_resolved_at(self):
        resp_ca = CorrectiveAction.objects.create(
            answer=self.answer, owner=self.member_b, description='Fix it', created_by=self.admin,
        )
        self.assertIsNone(resp_ca.resolved_at)

        admin_client = self.auth('admin', 'pw')
        resp = admin_client.patch(
            f'/api/v1/corrective-actions/{resp_ca.id}/', {'status': 'resolved'}, format='json'
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsNotNone(resp.data['resolved_at'])
