from django.utils import timezone

from apps.accounts.models import Team, User
from apps.core.test_utils import APIAuthTestCase
from apps.templates_app import services
from apps.templates_app.models import Template


class AssignmentPermissionTests(APIAuthTestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin', password='pw', role=User.Role.ADMIN)
        self.team_a = Team.objects.create(name='Team A')
        self.team_b = Team.objects.create(name='Team B')
        self.manager_a = User.objects.create_user(
            username='manager_a', password='pw', role=User.Role.MANAGER, team=self.team_a
        )
        self.member_a = User.objects.create_user(
            username='member_a', password='pw', role=User.Role.MEMBER, team=self.team_a
        )
        self.member_b = User.objects.create_user(
            username='member_b', password='pw', role=User.Role.MEMBER, team=self.team_b
        )

        template = Template.objects.create(name='Checklist', created_by=self.admin)
        draft = services.create_draft_version(template, self.admin)
        self.version = services.publish_version(draft, self.admin)

    def _create_assignment(self, client, **overrides):
        payload = {'template_version': str(self.version.id), 'due_date': timezone.now().isoformat()}
        payload.update(overrides)
        return client.post('/api/v1/assignments/', payload, format='json')

    def test_member_cannot_create_assignments(self):
        client = self.auth('member_a', 'pw')
        resp = self._create_assignment(client, assigned_user=self.member_a.id)
        self.assertEqual(resp.status_code, 403)

    def test_manager_can_assign_within_their_team(self):
        client = self.auth('manager_a', 'pw')
        resp = self._create_assignment(client, assigned_user=self.member_a.id)
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_manager_cannot_see_other_teams_assignments(self):
        admin_client = self.auth('admin', 'pw')
        resp = self._create_assignment(admin_client, assigned_user=self.member_b.id)
        self.assertEqual(resp.status_code, 201, resp.content)

        manager_client = self.auth('manager_a', 'pw')
        resp = manager_client.get('/api/v1/assignments/')
        self.assertEqual(resp.data['count'], 0)

    def test_member_only_sees_their_own_assignments(self):
        admin_client = self.auth('admin', 'pw')
        self._create_assignment(admin_client, assigned_user=self.member_a.id)
        self._create_assignment(admin_client, assigned_user=self.member_b.id)

        member_a_client = self.auth('member_a', 'pw')
        resp = member_a_client.get('/api/v1/assignments/')
        self.assertEqual(resp.data['count'], 1)
        self.assertEqual(resp.data['results'][0]['assigned_user'], self.member_a.id)

    def test_assignment_requires_exactly_one_target(self):
        admin_client = self.auth('admin', 'pw')
        resp = self._create_assignment(admin_client, assigned_user=self.member_a.id, assigned_team=self.team_a.id)
        self.assertEqual(resp.status_code, 400)

        resp = self._create_assignment(admin_client)
        self.assertEqual(resp.status_code, 400)
