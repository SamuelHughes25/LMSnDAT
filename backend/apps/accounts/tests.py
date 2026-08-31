from apps.core.test_utils import APIAuthTestCase
from .models import Team, User


class RoleScopingTests(APIAuthTestCase):
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

    def test_admin_sees_all_users(self):
        client = self.auth('admin', 'pw')
        resp = client.get('/api/v1/users/')
        usernames = {u['username'] for u in resp.data['results']}
        self.assertEqual(usernames, {'admin', 'manager_a', 'member_a', 'member_b'})

    def test_manager_sees_only_their_own_team(self):
        client = self.auth('manager_a', 'pw')
        resp = client.get('/api/v1/users/')
        usernames = {u['username'] for u in resp.data['results']}
        self.assertEqual(usernames, {'manager_a', 'member_a'})

    def test_member_sees_only_themselves(self):
        client = self.auth('member_a', 'pw')
        resp = client.get('/api/v1/users/')
        usernames = {u['username'] for u in resp.data['results']}
        self.assertEqual(usernames, {'member_a'})

    def test_only_admin_can_create_teams(self):
        manager_client = self.auth('manager_a', 'pw')
        resp = manager_client.post('/api/v1/teams/', {'name': 'New Team'}, format='json')
        self.assertEqual(resp.status_code, 403)

        admin_client = self.auth('admin', 'pw')
        resp = admin_client.post('/api/v1/teams/', {'name': 'New Team'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_me_returns_the_authenticated_users_own_record(self):
        client = self.auth('member_a', 'pw')
        resp = client.get('/api/v1/users/me/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['username'], 'member_a')
        self.assertEqual(resp.data['role'], 'member')
