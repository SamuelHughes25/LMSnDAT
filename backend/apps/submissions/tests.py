from django.utils import timezone

from apps.accounts.models import Team, User
from apps.core.test_utils import APIAuthTestCase


class SubmissionFlowTests(APIAuthTestCase):
    """End-to-end walk of the MVP contract: build a template, publish it,
    assign it, submit against it, and confirm a flagged answer is visible
    to a corrective action — the exact flow from the project brief."""

    def setUp(self):
        # role=ADMIN for apps.assignments.AssignmentViewSet's still-old
        # role-based IsAdminOrManager check (POSTs to /assignments/ below)
        # — that app wasn't part of the permission-sets rework. is_platform_admin
        # additionally covers the new tab-gated /templates/, /sections/,
        # /questions/ endpoints used earlier in the same flow.
        self.admin = User.objects.create_user(
            username='admin', password='pw', role=User.Role.ADMIN, is_platform_admin=True,
        )
        self.team = Team.objects.create(name='Ops Team')
        self.member = User.objects.create_user(
            username='member', password='pw', role=User.Role.MEMBER, team=self.team
        )

    def test_full_template_to_corrective_action_flow(self):
        admin_client = self.auth('admin', 'pw')
        member_client = self.auth('member', 'pw')

        resp = admin_client.post('/api/v1/templates/', {'name': 'Fire Extinguisher Check'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        template_id = resp.data['id']

        resp = admin_client.post(f'/api/v1/templates/{template_id}/create-draft/', format='json')
        version_id = resp.data['id']

        resp = member_client.post('/api/v1/templates/', {'name': 'nope'}, format='json')
        self.assertEqual(resp.status_code, 403)

        resp = admin_client.post(
            '/api/v1/sections/', {'template_version': version_id, 'title': 'Extinguisher', 'order': 0}, format='json'
        )
        section_id = resp.data['id']

        resp = admin_client.post('/api/v1/questions/', {
            'section': section_id, 'question_type': 'boolean', 'label': 'Charged?',
            'order': 0, 'is_required': True, 'config': {},
            'flag_rule': {'operator': 'equals', 'value': False},
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        question_id = resp.data['id']

        # select questions require options
        resp = admin_client.post('/api/v1/questions/', {
            'section': section_id, 'question_type': 'single_select', 'label': 'Condition', 'order': 1, 'config': {},
        }, format='json')
        self.assertEqual(resp.status_code, 400)

        resp = admin_client.post(f'/api/v1/template-versions/{version_id}/publish/', format='json')
        self.assertEqual(resp.data['status'], 'published')

        # published version content is immutable
        resp = admin_client.post('/api/v1/questions/', {
            'section': section_id, 'question_type': 'text', 'label': 'Late add', 'order': 2, 'config': {},
        }, format='json')
        self.assertEqual(resp.status_code, 400)

        resp = admin_client.post('/api/v1/assignments/', {
            'template_version': version_id, 'assigned_user': self.member.id,
            'due_date': timezone.now().isoformat(),
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        assignment_id = resp.data['id']

        resp = member_client.post('/api/v1/submissions/', {'assignment': assignment_id}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        submission_id = resp.data['id']
        self.assertEqual(str(resp.data['template_version']), str(version_id))

        resp = member_client.post(f'/api/v1/submissions/{submission_id}/answers/', {
            'answers': [{'question': question_id, 'value': False}],
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.data[0]['requires_action'])
        answer_id = resp.data[0]['id']

        resp = member_client.post(f'/api/v1/submissions/{submission_id}/submit/', format='json')
        self.assertEqual(resp.data['status'], 'submitted')

        resp = admin_client.get(f'/api/v1/assignments/{assignment_id}/')
        self.assertEqual(resp.data['status'], 'complete')

        resp = admin_client.post('/api/v1/corrective-actions/', {
            'answer': answer_id, 'owner': self.member.id, 'description': 'Refill extinguisher',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
