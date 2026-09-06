from apps.core.test_utils import APIAuthTestCase
from apps.courses.models import Course
from apps.templates_app.models import Template
from .models import JobRole, Team, User


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


class JobRoleTests(APIAuthTestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin', password='pw', role=User.Role.ADMIN)
        self.member = User.objects.create_user(username='member', password='pw', role=User.Role.MEMBER)
        self.course = Course.objects.create(name='Gas Safety', created_by=self.admin)
        self.template = Template.objects.create(name='Gas Audit', created_by=self.admin)

    def test_only_admin_can_create_a_job_role(self):
        member_client = self.auth('member', 'pw')
        resp = member_client.post('/api/v1/job-roles/', {'name': 'Gas Engineer'}, format='json')
        self.assertEqual(resp.status_code, 403)

        admin_client = self.auth('admin', 'pw')
        resp = admin_client.post('/api/v1/job-roles/', {'name': 'Gas Engineer'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_any_authenticated_user_can_read_job_roles(self):
        JobRole.objects.create(name='Gas Engineer')
        member_client = self.auth('member', 'pw')
        resp = member_client.get('/api/v1/job-roles/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual([r['name'] for r in resp.data['results']], ['Gas Engineer'])

    def test_assigning_a_course_and_template_to_a_job_role(self):
        role = JobRole.objects.create(name='Gas Engineer')
        admin_client = self.auth('admin', 'pw')
        resp = admin_client.patch(
            f'/api/v1/job-roles/{role.id}/',
            {'courses': [str(self.course.id)], 'templates': [str(self.template.id)]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        role.refresh_from_db()
        self.assertEqual(list(role.courses.all()), [self.course])
        self.assertEqual(list(role.templates.all()), [self.template])

    def test_only_admin_can_delete_a_job_role(self):
        role = JobRole.objects.create(name='Gas Engineer')
        member_client = self.auth('member', 'pw')
        resp = member_client.delete(f'/api/v1/job-roles/{role.id}/')
        self.assertEqual(resp.status_code, 403)

        admin_client = self.auth('admin', 'pw')
        resp = admin_client.delete(f'/api/v1/job-roles/{role.id}/')
        self.assertEqual(resp.status_code, 204)


class UserCreationTests(APIAuthTestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin', password='pw', role=User.Role.ADMIN)
        self.role = JobRole.objects.create(name='Gas Engineer')

    def test_created_user_can_log_in_with_the_given_password(self):
        admin_client = self.auth('admin', 'pw')
        resp = admin_client.post(
            '/api/v1/users/',
            {'username': 'new_operative', 'password': 'a-real-password', 'job_role': str(self.role.id)},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertNotIn('password', resp.data)

        login = self.client.post(
            '/api/v1/auth/token/',
            {'username': 'new_operative', 'password': 'a-real-password'},
            format='json',
        )
        self.assertEqual(login.status_code, 200, login.content)

    def test_only_admin_can_create_users(self):
        member = User.objects.create_user(username='member', password='pw', role=User.Role.MEMBER)
        member_client = self.auth('member', 'pw')
        resp = member_client.post('/api/v1/users/', {'username': 'sneaky', 'password': 'pw'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_search_and_job_role_filters_on_user_list(self):
        User.objects.create_user(username='alice', password='pw', job_role=self.role)
        User.objects.create_user(username='bob', password='pw')
        admin_client = self.auth('admin', 'pw')

        resp = admin_client.get('/api/v1/users/?search=ali')
        self.assertEqual([u['username'] for u in resp.data['results']], ['alice'])

        resp = admin_client.get(f'/api/v1/users/?job_role={self.role.id}')
        self.assertEqual([u['username'] for u in resp.data['results']], ['alice'])
