from apps.core.test_utils import APIAuthTestCase
from apps.courses.models import Course
from apps.templates_app.models import Template
from .models import Group, PermissionSet, Team, User


class UserVisibilityScopingTests(APIAuthTestCase):
    """Dashboard access is no longer role-based (admin/manager/member) —
    it's driven entirely by PermissionSet tab grants (plus the
    is_superuser/is_platform_admin tiers that bypass tab checks
    altogether). There's no team-scoped middle tier any more either: a
    permission set's `can_access_users` is global, not per-team — see
    apps.core.permissions.user_can_access_tab's own comment on this
    deliberate change from the old role-based team-scoping."""

    def setUp(self):
        users_set = PermissionSet.objects.create(name='User Manager', can_access_users=True)
        self.admin = User.objects.create_user(username='admin', password='pw', permission_set=users_set)
        self.team_a = Team.objects.create(name='Team A')
        # A dashboard-eligible user with NO permission set at all — the
        # new equivalent of "not an admin," replacing the old plain
        # role=MANAGER fixture.
        self.narrow_user = User.objects.create_user(username='narrow_user', password='pw', team=self.team_a)
        self.member_a = User.objects.create_user(
            username='member_a', password='pw', role=User.Role.MEMBER, team=self.team_a
        )
        self.member_b = User.objects.create_user(username='member_b', password='pw', role=User.Role.MEMBER)

    def test_user_with_users_tab_access_sees_everyone(self):
        client = self.auth('admin', 'pw')
        resp = client.get('/api/v1/users/')
        usernames = {u['username'] for u in resp.data['results']}
        self.assertEqual(usernames, {'admin', 'narrow_user', 'member_a', 'member_b'})

    def test_user_without_users_tab_access_sees_only_themselves(self):
        client = self.auth('narrow_user', 'pw')
        resp = client.get('/api/v1/users/')
        usernames = {u['username'] for u in resp.data['results']}
        self.assertEqual(usernames, {'narrow_user'})

    def test_member_sees_only_themselves(self):
        client = self.auth('member_a', 'pw')
        resp = client.get('/api/v1/users/')
        usernames = {u['username'] for u in resp.data['results']}
        self.assertEqual(usernames, {'member_a'})

    def test_creating_teams_requires_users_tab_access(self):
        narrow_client = self.auth('narrow_user', 'pw')
        resp = narrow_client.post('/api/v1/teams/', {'name': 'New Team'}, format='json')
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


class PermissionSetTests(APIAuthTestCase):
    """The Permissions tab/model itself — CRUD gated on can_access_permissions,
    same shape as every other dashboard tab."""

    def setUp(self):
        perms_set = PermissionSet.objects.create(name='Permission Manager', can_access_permissions=True)
        self.admin = User.objects.create_user(username='perm_admin', password='pw', permission_set=perms_set)
        self.plain = User.objects.create_user(username='perm_plain', password='pw')

    def test_only_permissions_tab_access_can_create_a_permission_set(self):
        plain_client = self.auth('perm_plain', 'pw')
        resp = plain_client.post('/api/v1/permission-sets/', {'name': 'Course Manager'}, format='json')
        self.assertEqual(resp.status_code, 403)

        admin_client = self.auth('perm_admin', 'pw')
        resp = admin_client.post(
            '/api/v1/permission-sets/', {'name': 'Course Manager', 'can_access_courses': True}, format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(resp.data['can_access_courses'])
        self.assertFalse(resp.data['can_access_users'])

    def test_any_authenticated_user_can_read_permission_sets(self):
        PermissionSet.objects.create(name='Course Manager', can_access_courses=True)
        plain_client = self.auth('perm_plain', 'pw')
        resp = plain_client.get('/api/v1/permission-sets/')
        self.assertEqual(resp.status_code, 200, resp.content)


class GroupTests(APIAuthTestCase):
    def setUp(self):
        groups_set = PermissionSet.objects.create(name='Group Manager', can_access_groups=True)
        self.admin = User.objects.create_user(username='admin', password='pw', permission_set=groups_set)
        self.member = User.objects.create_user(username='member', password='pw', role=User.Role.MEMBER)
        self.course = Course.objects.create(name='Gas Safety', created_by=self.admin)
        self.template = Template.objects.create(name='Gas Audit', created_by=self.admin)

    def test_only_groups_tab_access_can_create_a_group(self):
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

    def test_only_groups_tab_access_can_delete_a_group(self):
        group = Group.objects.create(name='Gas Engineers')
        member_client = self.auth('member', 'pw')
        resp = member_client.delete(f'/api/v1/groups/{group.id}/')
        self.assertEqual(resp.status_code, 403)

        admin_client = self.auth('admin', 'pw')
        resp = admin_client.delete(f'/api/v1/groups/{group.id}/')
        self.assertEqual(resp.status_code, 204)


class UserCreationTests(APIAuthTestCase):
    def setUp(self):
        users_set = PermissionSet.objects.create(name='User Manager', can_access_users=True)
        self.admin = User.objects.create_user(username='admin', password='pw', permission_set=users_set)
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

    def test_only_users_tab_access_can_create_users(self):
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


class PlatformAdminTests(APIAuthTestCase):
    """The is_platform_admin tier — full access, but revocable, and only
    an is_superuser account can grant/revoke it. is_superuser itself is
    never created through the API at all (see User.is_superuser's own
    comment), so there's no equivalent "only a superuser can touch this"
    creation test — only grant/revoke are reachable."""

    def setUp(self):
        self.superuser = User.objects.create_user(username='the_super', password='pw', is_superuser=True)
        self.platform_admin = User.objects.create_user(username='plat_admin', password='pw', is_platform_admin=True)
        self.plain = User.objects.create_user(username='plain_user', password='pw')

    def test_only_superuser_can_grant_platform_admin(self):
        plain_client = self.auth('plain_user', 'pw')
        resp = plain_client.post(f'/api/v1/users/{self.plain.id}/grant-platform-admin/')
        self.assertEqual(resp.status_code, 403)

        platform_admin_client = self.auth('plat_admin', 'pw')
        resp = platform_admin_client.post(f'/api/v1/users/{self.plain.id}/grant-platform-admin/')
        self.assertEqual(resp.status_code, 403, "a platform admin is not the super-super-user")

        superuser_client = self.auth('the_super', 'pw')
        resp = superuser_client.post(f'/api/v1/users/{self.plain.id}/grant-platform-admin/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.plain.refresh_from_db()
        self.assertTrue(self.plain.is_platform_admin)

    def test_only_superuser_can_revoke_platform_admin(self):
        superuser_client = self.auth('the_super', 'pw')
        resp = superuser_client.post(f'/api/v1/users/{self.platform_admin.id}/revoke-platform-admin/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.platform_admin.refresh_from_db()
        self.assertFalse(self.platform_admin.is_platform_admin)

    def test_platform_admin_bypasses_every_tab(self):
        client = self.auth('plat_admin', 'pw')
        for path in ('/api/v1/courses/', '/api/v1/templates/', '/api/v1/users/', '/api/v1/groups/', '/api/v1/permission-sets/'):
            resp = client.get(path)
            self.assertEqual(resp.status_code, 200, f'{path}: {resp.content}')


class SuperuserProtectionTests(APIAuthTestCase):
    """The one permanently-protected super-super-user tier — see
    User.is_superuser's own comment. Never archivable/deletable by
    anyone, including another is_superuser account or itself."""

    def setUp(self):
        self.superuser = User.objects.create_user(username='the_super', password='pw', is_superuser=True)

    def test_superuser_account_cannot_be_archived(self):
        client = self.auth('the_super', 'pw')
        resp = client.delete(f'/api/v1/users/{self.superuser.id}/')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.superuser.refresh_from_db()
        self.assertTrue(self.superuser.is_active)

    def test_superuser_account_cannot_be_purged_even_once_inactive(self):
        # Can't go through the normal destroy() path (it's blocked above),
        # so deactivate directly to exercise purge()'s own independent guard.
        self.superuser.is_active = False
        self.superuser.save(update_fields=['is_active'])
        other_superuser = User.objects.create_user(username='the_super2', password='pw', is_superuser=True)
        client = self.auth('the_super2', 'pw')
        resp = client.post(f'/api/v1/users/{self.superuser.id}/purge/')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertTrue(User.objects.filter(id=self.superuser.id).exists())

    def test_superuser_account_cannot_be_edited_by_anyone_else(self):
        # Found during a review pass: destroy/purge were guarded, but a
        # plain PATCH through the ordinary update path was not — anyone
        # with Users tab access could silently overwrite the
        # super-super-user's password (a full account takeover) or demote
        # its role. UserViewSet.update is what closes this.
        users_tab = PermissionSet.objects.create(name='Users Tab', can_access_users=True)
        attacker = User.objects.create_user(username='attacker', password='pw', permission_set=users_tab)
        client = self.auth('attacker', 'pw')
        original_role = self.superuser.role

        resp = client.patch(f'/api/v1/users/{self.superuser.id}/', {'password': 'TakenOver123!'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.superuser.refresh_from_db()
        self.assertTrue(self.superuser.check_password('pw'), "password must be unchanged")

        # role's own default is already 'member' (see User.role), so this
        # specifically targets a DIFFERENT value than whatever it started
        # at — asserting it's merely "not member" afterward would trivially
        # pass even if the guard did nothing, when the fixture's own
        # starting role already happens to be 'member'.
        target_role = 'manager' if original_role != 'manager' else 'admin'
        resp = client.patch(f'/api/v1/users/{self.superuser.id}/', {'role': target_role}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.superuser.refresh_from_db()
        self.assertEqual(self.superuser.role, original_role)

    def test_superuser_can_still_edit_their_own_account(self):
        client = self.auth('the_super', 'pw')
        resp = client.patch(f'/api/v1/users/{self.superuser.id}/', {'email': 'me@example.com'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.superuser.refresh_from_db()
        self.assertEqual(self.superuser.email, 'me@example.com')

    def test_superuser_cannot_delete_their_own_account(self):
        client = self.auth('the_super', 'pw')
        resp = client.delete(f'/api/v1/users/{self.superuser.id}/')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.superuser.refresh_from_db()
        self.assertTrue(self.superuser.is_active)

    def test_superuser_excluded_from_user_list(self):
        client = self.auth('the_super', 'pw')
        resp = client.get('/api/v1/users/')
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [row['id'] for row in resp.data['results']]
        self.assertNotIn(self.superuser.id, ids)

    def test_superuser_still_directly_retrievable_by_id(self):
        # The list exclusion is deliberately scoped to the `list` action
        # only (see UserViewSet.get_queryset's own comment) — a direct
        # retrieve, e.g. the account page's own flow, must still resolve.
        client = self.auth('the_super', 'pw')
        resp = client.get(f'/api/v1/users/{self.superuser.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)


class PlatformAdminEditProtectionTests(APIAuthTestCase):
    """Same class of hole as SuperuserProtectionTests above, one tier
    down: a super user (is_platform_admin) is meant to be demotable only
    by the super-super-user (see grant_platform_admin/
    revoke_platform_admin's IsSuperuser gate), but a plain PATCH through
    the ordinary update path used to reach the exact same outcome
    (password takeover, role/permission_set demotion) without ever going
    through that gate."""

    def setUp(self):
        self.superuser = User.objects.create_user(username='the_super', password='pw', is_superuser=True)
        # role='admin' explicitly — the model's default role is 'member',
        # which would make a post-PATCH "role is still not 'member'"
        # assertion trivially true/false regardless of whether the guard
        # actually did anything, since that'd already be its starting
        # value. Needs a real, non-'member' starting role for the
        # unchanged-after-blocked-PATCH assertions below to mean anything.
        self.platform_admin = User.objects.create_user(
            username='plat_admin', password='pw', role=User.Role.ADMIN, is_platform_admin=True,
        )
        users_tab = PermissionSet.objects.create(name='Users Tab', can_access_users=True)
        self.attacker = User.objects.create_user(username='attacker', password='pw', permission_set=users_tab)

    def test_plain_users_tab_admin_cannot_edit_a_platform_admin(self):
        client = self.auth('attacker', 'pw')
        resp = client.patch(f'/api/v1/users/{self.platform_admin.id}/', {'password': 'TakenOver123!'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.platform_admin.refresh_from_db()
        self.assertTrue(self.platform_admin.check_password('pw'))

    def test_fellow_platform_admin_cannot_edit_another_platform_admin(self):
        User.objects.create_user(username='plat_admin2', password='pw', is_platform_admin=True)
        client = self.auth('plat_admin2', 'pw')
        resp = client.patch(f'/api/v1/users/{self.platform_admin.id}/', {'role': 'member'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.platform_admin.refresh_from_db()
        self.assertEqual(self.platform_admin.role, User.Role.ADMIN)

    def test_superuser_can_still_edit_a_platform_admin(self):
        client = self.auth('the_super', 'pw')
        resp = client.patch(f'/api/v1/users/{self.platform_admin.id}/', {'email': 'pa@example.com'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_platform_admin_can_still_edit_an_ordinary_user(self):
        plain = User.objects.create_user(username='plain_user', password='pw')
        client = self.auth('plat_admin', 'pw')
        resp = client.patch(f'/api/v1/users/{plain.id}/', {'email': 'plain@example.com'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_platform_admin_can_still_edit_their_own_account(self):
        client = self.auth('plat_admin', 'pw')
        resp = client.patch(f'/api/v1/users/{self.platform_admin.id}/', {'email': 'self@example.com'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)


class UserArchiveTests(APIAuthTestCase):
    """DELETE on a user now archives (deactivates) instead of hard-deleting
    — see CourseViewSet/TemplateViewSet.destroy for the identical pattern
    on the other two entities that can be archived. The real, final hard
    delete only lives behind the new `purge` action, reachable only once a
    user is already archived, and deliberately stays blocked (rather than
    cascading) when the user owns real content — see UserViewSet.purge's
    own comment for why. Every real interaction a user has with this
    platform otherwise goes through an on_delete=PROTECT foreign key back
    to them (see apps/core/exceptions.py's own comment for the full list)."""

    def setUp(self):
        self.admin = User.objects.create_user(username='del_admin', password='pw', is_platform_admin=True)

    def test_delete_archives_instead_of_deleting(self):
        plain = User.objects.create_user(username='del_plain', password='pw')
        admin_client = self.auth('del_admin', 'pw')
        resp = admin_client.delete(f'/api/v1/users/{plain.id}/')
        self.assertEqual(resp.status_code, 204, resp.content)
        plain.refresh_from_db()
        self.assertFalse(plain.is_active)
        self.assertEqual(plain.archived_by_id, self.admin.id)
        self.assertIsNotNone(plain.archived_at)

    def test_cannot_archive_your_own_account(self):
        admin_client = self.auth('del_admin', 'pw')
        resp = admin_client.delete(f'/api/v1/users/{self.admin.id}/')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    # No API-level test for purge's own self-delete guard: unlike destroy
    # (reachable while still active), reaching purge on yourself requires
    # being is_active=False first — and confirmed directly while writing
    # this suite, SimpleJWT's JWTAuthentication re-checks is_active on
    # EVERY authenticated request (not just at token-issue), so a
    # deactivated account can never successfully authenticate at all,
    # making a true self-purge attempt unreachable through the HTTP API
    # regardless of this guard. The guard itself stays in purge() as
    # cheap defense-in-depth (e.g. against a future auth backend change
    # that stops re-checking is_active per-request), but there's no
    # meaningful way to exercise it through this test case's own
    # request-based style.

    def test_restore_reactivates_and_clears_audit_fields(self):
        plain = User.objects.create_user(username='del_plain', password='pw')
        admin_client = self.auth('del_admin', 'pw')
        admin_client.delete(f'/api/v1/users/{plain.id}/')
        resp = admin_client.post(f'/api/v1/users/{plain.id}/restore/')
        self.assertEqual(resp.status_code, 200, resp.content)
        plain.refresh_from_db()
        self.assertTrue(plain.is_active)
        self.assertIsNone(plain.archived_by_id)
        self.assertIsNone(plain.archived_at)

    def test_purge_requires_archiving_first(self):
        plain = User.objects.create_user(username='del_plain', password='pw')
        admin_client = self.auth('del_admin', 'pw')
        resp = admin_client.post(f'/api/v1/users/{plain.id}/purge/')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertTrue(User.objects.filter(id=plain.id).exists())

    def test_purge_with_no_references_actually_deletes(self):
        plain = User.objects.create_user(username='del_plain', password='pw')
        admin_client = self.auth('del_admin', 'pw')
        admin_client.delete(f'/api/v1/users/{plain.id}/')
        resp = admin_client.post(f'/api/v1/users/{plain.id}/purge/')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(User.objects.filter(id=plain.id).exists())

    def test_purge_blocked_with_clear_message_when_user_owns_a_course(self):
        # A separate creator (not self.admin) is archived/purged here, not
        # self.admin itself — simplejwt's own JWTAuthentication rejects a
        # token whose user has gone inactive, so an admin can't archive
        # their own currently-authenticated account mid-test and keep
        # making authenticated requests with the same client.
        creator = User.objects.create_user(username='del_creator', password='pw')
        course = Course.objects.create(name='Del Course', created_by=creator)
        admin_client = self.auth('del_admin', 'pw')
        admin_client.delete(f'/api/v1/users/{creator.id}/')
        resp = admin_client.post(f'/api/v1/users/{creator.id}/purge/')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('owns', resp.data['detail'])
        self.assertTrue(User.objects.filter(id=creator.id).exists())
        # Named, not just counted — the frontend links straight to each
        # one so the admin knows exactly where to go reassign it.
        self.assertEqual(resp.data['owned_courses'], [{'id': course.id, 'name': 'Del Course'}])
        self.assertEqual(resp.data['owned_templates'], [])

    def test_transferring_ownership_away_unblocks_a_previously_blocked_purge(self):
        # The actual end-to-end point of Course.owner being transferable
        # (apps.core.permissions/CourseViewSet.transfer_ownership): this
        # check is against `owner`, not the permanent `created_by`, so
        # handing ownership to someone else is what's supposed to unblock
        # purging the original owner — see UserViewSet.purge's own comment.
        creator = User.objects.create_user(username='del_creator2', password='pw')
        new_owner = User.objects.create_user(username='del_new_owner', password='pw')
        course = Course.objects.create(name='Transfer Me', created_by=creator)
        admin_client = self.auth('del_admin', 'pw')

        admin_client.delete(f'/api/v1/users/{creator.id}/')
        blocked = admin_client.post(f'/api/v1/users/{creator.id}/purge/')
        self.assertEqual(blocked.status_code, 400, blocked.content)

        # transfer-ownership is is_superuser-only now (not even
        # is_platform_admin, which del_admin only has) — see
        # apps.core.permissions.IsSuperuser's own comment.
        superuser = User.objects.create_user(username='del_superuser', password='pw', is_superuser=True)
        superuser_client = self.auth('del_superuser', 'pw')
        transfer = superuser_client.post(
            f'/api/v1/courses/{course.id}/transfer-ownership/', {'owner': new_owner.id}, format='json',
        )
        self.assertEqual(transfer.status_code, 200, transfer.content)

        unblocked = admin_client.post(f'/api/v1/users/{creator.id}/purge/')
        self.assertEqual(unblocked.status_code, 204, unblocked.content)
        self.assertFalse(User.objects.filter(id=creator.id).exists())


class NarrowPermissionSetIsolationTests(APIAuthTestCase):
    """A permission set granting only ONE tab must not leak access to any
    other — the core promise of the whole system being "configurable"
    rather than a blunt admin/not-admin switch."""

    def setUp(self):
        courses_only = PermissionSet.objects.create(name='Courses Only', can_access_courses=True)
        self.user = User.objects.create_user(username='narrow_courses', password='pw', permission_set=courses_only)

    def test_granted_tab_works_other_tabs_are_blocked(self):
        client = self.auth('narrow_courses', 'pw')

        resp = client.post('/api/v1/courses/', {'name': 'Allowed'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)

        for path, payload in (
            ('/api/v1/templates/', {'name': 'nope'}),
            ('/api/v1/groups/', {'name': 'nope'}),
            ('/api/v1/permission-sets/', {'name': 'nope'}),
        ):
            resp = client.post(path, payload, format='json')
            self.assertEqual(resp.status_code, 403, f'{path}: {resp.content}')

        # Users tab: list is scoped to self rather than a flat 403 (see
        # UserViewSet.get_queryset) — still not the global visibility
        # 'users' tab access would grant.
        resp = client.get('/api/v1/users/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual([u['username'] for u in resp.data['results']], ['narrow_courses'])
