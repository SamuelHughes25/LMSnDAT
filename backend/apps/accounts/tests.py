from apps.core.test_utils import APIAuthTestCase
from apps.courses.models import Course
from apps.templates_app.models import Template
from .models import Group, Team, User


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


class GroupTests(APIAuthTestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin', password='pw', role=User.Role.ADMIN)
        self.member = User.objects.create_user(username='member', password='pw', role=User.Role.MEMBER)
        self.course = Course.objects.create(name='Gas Safety', created_by=self.admin)
        self.template = Template.objects.create(name='Gas Audit', created_by=self.admin)

    def test_only_admin_can_create_a_group(self):
        member_client = self.auth('member', 'pw')
        resp = member_client.post('/api/v1/groups/', {'name': 'Gas Engineers'}, format='json')
        self.assertEqual(resp.status_code, 403)

        admin_client = self.auth('admin', 'pw')
        resp = admin_client.post('/api/v1/groups/', {'name': 'Gas Engineers'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_any_authenticated_user_can_read_groups(self):
        Group.objects.create(name='Gas Engineers')
        member_client = self.auth('member', 'pw')
        resp = member_client.get('/api/v1/groups/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual([g['name'] for g in resp.data['results']], ['Gas Engineers'])

    def test_a_group_bundles_both_courses_and_templates_together(self):
        """The whole point of a group, per an explicit correction: one
        group mixes whatever courses AND templates its owner decides — e.g.
        "Commercial Dwelling Engineer" bundling that role's training
        courses and its audit templates as a single assignable unit, not
        two separate systems."""
        group = Group.objects.create(name='Commercial Dwelling Engineer')
        admin_client = self.auth('admin', 'pw')
        resp = admin_client.patch(
            f'/api/v1/groups/{group.id}/',
            {'courses': [str(self.course.id)], 'templates': [str(self.template.id)]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        group.refresh_from_db()
        self.assertEqual(list(group.courses.all()), [self.course])
        self.assertEqual(list(group.templates.all()), [self.template])

    def test_only_admin_can_delete_a_group(self):
        group = Group.objects.create(name='Gas Engineers')
        member_client = self.auth('member', 'pw')
        resp = member_client.delete(f'/api/v1/groups/{group.id}/')
        self.assertEqual(resp.status_code, 403)

        admin_client = self.auth('admin', 'pw')
        resp = admin_client.delete(f'/api/v1/groups/{group.id}/')
        self.assertEqual(resp.status_code, 204)


class UserCreationTests(APIAuthTestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin', password='pw', role=User.Role.ADMIN)
        self.group = Group.objects.create(name='Gas Engineers')

    def test_created_user_can_log_in_with_the_given_password(self):
        admin_client = self.auth('admin', 'pw')
        resp = admin_client.post(
            '/api/v1/users/',
            {
                'username': 'new_operative', 'password': 'a-real-password',
                'content_groups': [str(self.group.id)],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertNotIn('password', resp.data)
        self.assertEqual(resp.data['content_groups'], [self.group.id])

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

    def test_search_and_group_filter_on_user_list(self):
        alice = User.objects.create_user(username='alice', password='pw')
        alice.content_groups.add(self.group)
        User.objects.create_user(username='bob', password='pw')
        admin_client = self.auth('admin', 'pw')

        resp = admin_client.get('/api/v1/users/?search=ali')
        self.assertEqual([u['username'] for u in resp.data['results']], ['alice'])

        resp = admin_client.get(f'/api/v1/users/?group={self.group.id}')
        self.assertEqual([u['username'] for u in resp.data['results']], ['alice'])

    def test_user_can_belong_to_multiple_groups(self):
        """"Everyone might need access to something like Don't Walk By, or
        Asbestos Training" on top of their main job-description group —
        the reason content_groups is an M2M, not a single FK."""
        second_group = Group.objects.create(name="Don't Walk By")
        admin_client = self.auth('admin', 'pw')
        resp = admin_client.post(
            '/api/v1/users/',
            {
                'username': 'multi_group_user', 'password': 'pw',
                'content_groups': [str(self.group.id), str(second_group.id)],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        user = User.objects.get(username='multi_group_user')
        self.assertEqual(set(user.content_groups.values_list('id', flat=True)), {self.group.id, second_group.id})


class UserDeletionTests(APIAuthTestCase):
    """Every real interaction a user has with this platform — creating a
    course, taking one, being directly assigned one — goes through an
    on_delete=PROTECT foreign key back to them (see apps/core/exceptions.py's
    own comment for the full list and why PROTECT, not CASCADE, is the
    deliberate choice for an audit-compliance product). Without a handler
    for that, deleting almost any user who has ever done anything in the
    app 500s instead of failing cleanly — found by literally hitting this
    while cleaning up test data during a hardening pass, not a contrived
    scenario."""

    def setUp(self):
        self.admin = User.objects.create_user(username='del_admin', password='pw', role=User.Role.ADMIN)

    def test_deleting_a_user_who_created_a_course_is_a_clean_400_not_a_500(self):
        Course.objects.create(name='Del Course', created_by=self.admin)
        admin_client = self.auth('del_admin', 'pw')
        resp = admin_client.delete(f'/api/v1/users/{self.admin.id}/')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('detail', resp.data)
        self.assertTrue(User.objects.filter(id=self.admin.id).exists())

    def test_deleting_a_user_with_no_references_still_works(self):
        plain = User.objects.create_user(username='del_plain', password='pw')
        admin_client = self.auth('del_admin', 'pw')
        resp = admin_client.delete(f'/api/v1/users/{plain.id}/')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(User.objects.filter(id=plain.id).exists())
