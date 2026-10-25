from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasArchiveTabAccess, HasDashboardTabAccess, IsSuperuser, user_can_access_tab
from apps.courses.models import Course
from apps.templates_app.models import Template
from .models import Group, PermissionSet, Team, User
from .serializers import GroupSerializer, PermissionSetSerializer, TeamSerializer, UserSerializer


class UserViewSet(viewsets.ModelViewSet):
    # archived_by alongside team/permission_set — UserSerializer's
    # archived_by_username reads archived_by.username per row, a real N+1
    # on the Archive page's user list (same bug class as CourseViewSet/
    # TemplateViewSet — see their own comments).
    queryset = User.objects.select_related('team', 'permission_set', 'archived_by').prefetch_related(
        'content_groups',
    ).all()
    serializer_class = UserSerializer
    required_tab = 'users'

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update'):
            return [HasDashboardTabAccess()]
        if self.action in ('destroy', 'restore', 'purge'):
            return [HasArchiveTabAccess()]
        if self.action in ('grant_platform_admin', 'revoke_platform_admin'):
            # "Only me the super super user can do this" — not tab-based
            # at all, see IsSuperuser's own docstring.
            return [IsSuperuser()]
        return [IsAuthenticated()]

    @action(detail=False, methods=['get'])
    def me(self, request):
        return Response(UserSerializer(request.user, context={'request': request}).data)

    # Self-service only — `detail=False` and always acts on request.user,
    # same "no pk, operates on the caller" shape as `me` above, deliberately
    # NOT a `/users/{id}/change-password/` detail action: every account
    # (operative/member included, not just dashboard admins — see the
    # default IsAuthenticated fallback in get_permissions, no tab check at
    # all) needs to be able to change its OWN password, and only its own —
    # an admin resetting someone ELSE's password already has a separate,
    # existing path (UserSerializer's own writable `password` field via a
    # plain PATCH, gated by HasDashboardTabAccess like any other field).
    # Requiring the CURRENT password here is what makes this meaningfully
    # different from that admin-reset path: proof the caller actually knows
    # the account's existing credential, not just that they have dashboard
    # access to the Users tab.
    @action(detail=False, methods=['post'], url_path='change-password')
    def change_password(self, request):
        old_password = request.data.get('old_password')
        new_password = request.data.get('new_password')
        if not old_password or not new_password:
            return Response({'detail': 'Both old_password and new_password are required.'}, status=400)
        if not request.user.check_password(old_password):
            return Response({'detail': 'Current password is incorrect.'}, status=400)
        if len(new_password) < 8:
            return Response({'detail': 'New password must be at least 8 characters.'}, status=400)
        request.user.set_password(new_password)
        request.user.save(update_fields=['password'])
        return Response(status=204)

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        # Full visibility for anyone with Users tab access (or above) —
        # no team-scoping any more, see apps.core.permissions
        # .user_can_access_tab's own comment on this deliberate change.
        # Anyone else only ever sees themselves.
        if not user_can_access_tab(user, 'users'):
            qs = qs.filter(pk=user.pk)

        # The super-super-user account is permanently protected (can't be
        # archived/deleted/demoted by anyone — see destroy/purge below) and
        # isn't managed through this UI at all, so it has no business
        # showing up in the Users list/search/group-filter results either —
        # there's nothing there an admin could actually DO to that row.
        # Scoped to `list` specifically (not retrieve/update/destroy) so it
        # doesn't also block `/users/me/`-style direct lookups were the
        # super-super-user ever to need one.
        if self.action == 'list':
            qs = qs.exclude(is_superuser=True)

        # Manual query-param filtering (search-by-username, filter-by-
        # group/permission-set/role) applied on TOP of the scoping above,
        # matching this codebase's existing "no django-filter, just
        # get_queryset()" style used elsewhere for parent-scoping (e.g.
        # ?course= on child viewsets) — there's no SearchFilter/
        # DjangoFilterBackend anywhere in this project to introduce a new
        # dependency for.
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(username__icontains=search)

        # Each of group/permission_set/role accepts the query param
        # repeated (?group=a&group=b — getlist(), not get()) for the
        # Users page's multi-select Filters panel: multiple values within
        # ONE category are OR'd together (any matching group counts), but
        # the three categories are AND'd against each other (a user has to
        # match the group filter AND the permission-set filter AND the
        # role filter, whichever of the three actually have a value set).
        # .distinct() once at the end covers the one filter here that
        # joins across a many-to-many (content_groups) and so could
        # otherwise fan a single user out into one row per matching group.
        group_ids = self.request.query_params.getlist('group')
        if group_ids:
            qs = qs.filter(content_groups__in=group_ids)
        permission_set_ids = self.request.query_params.getlist('permission_set')
        if permission_set_ids:
            qs = qs.filter(permission_set__in=permission_set_ids)
        roles = self.request.query_params.getlist('role')
        if roles:
            qs = qs.filter(role__in=roles)
        if group_ids:
            qs = qs.distinct()

        # Mirrors CourseViewSet/TemplateViewSet.get_queryset's is_archived
        # filter exactly — "archived" for a User means deactivated
        # (is_active=False), which already blocks login via Django's
        # stock auth backend, so this one filter also removes them from
        # every team/group member listing that reuses this same endpoint.
        if self.request.query_params.get('archived') == 'true':
            qs = qs.filter(is_active=False)
        else:
            qs = qs.filter(is_active=True)
        return qs

    def update(self, request, *args, **kwargs):
        # Found during a review pass, not asked for directly, but a real
        # hole: destroy/purge below both already refuse to touch an
        # is_superuser row, but nothing stopped a plain PATCH/PUT through
        # here — anyone with HasDashboardTabAccess to the Users tab (not
        # even is_platform_admin required) could silently change the
        # super-super-user's `role` (e.g. demote it to 'member', which
        # (dashboard)/layout.tsx would then bounce straight out of the
        # dashboard on its own next login) or, far worse, overwrite its
        # `password` via UserSerializer's ordinary admin-reset field —
        # effectively a full account takeover of the one account every
        # other protection in this app (grant/revoke platform-admin,
        # archive/purge guards) assumes is unreachable. "can never be...
        # edited by anyone else" was always the stated intent (see this
        # app's own permission-sets plan) — this is what actually
        # enforces it. Self-edits (is_superuser updating their OWN row)
        # stay allowed, same "you can always touch your own account"
        # exception change_password above already carries. partial_update
        # isn't separately overridden — DRF's own UpdateModelMixin routes
        # it through this same method (just with partial=True), so it's
        # covered for free.
        instance = self.get_object()
        if instance.pk == request.user.pk:
            return super().update(request, *args, **kwargs)
        if instance.is_superuser:
            return Response({'detail': "The super-super-user account can't be edited by anyone else."}, status=400)
        # Same hole, one tier down: a super user (is_platform_admin) is
        # meant to be demotable/removable ONLY by the super-super-user
        # (see grant_platform_admin/revoke_platform_admin's own IsSuperuser
        # gate, and destroy/purge's matching guard above) — but nothing
        # stopped a plain Users-tab admin from getting the exact same
        # outcome through an ordinary PATCH instead: overwrite `password`
        # (account takeover) or `role`/`permission_set` (an effective,
        # ungated demotion) without ever touching the actions that were
        # SUPPOSED to be the only door for that. Confirmed live during a
        # review pass, same class of bug as the is_superuser case above.
        if instance.is_platform_admin and not request.user.is_superuser:
            return Response({'detail': "Only the super-super-user can edit a super user account."}, status=400)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        # The trash button now archives (deactivates) instead of hard-
        # deleting — mirrors CourseViewSet.destroy/TemplateViewSet.destroy.
        user = self.get_object()
        if user.is_superuser:
            return Response({'detail': "The super-super-user account can't be archived or deleted."}, status=400)
        # A super user (is_platform_admin) can only be archived/deleted by
        # the super-super-user — never by a peer super user, and never by
        # anyone whose access comes from a permission set (even one with
        # Archive tab granted, which is otherwise enough to reach this
        # action at all via HasArchiveTabAccess) — "cannot be deleted by
        # anyone else below them," per the user's own words. Mirrored in
        # purge below for the same reason.
        if user.is_platform_admin and not request.user.is_superuser:
            return Response({'detail': "Only the super-super-user can archive or delete a super user account."}, status=400)
        # Nobody archives their own account from here, regardless of tier —
        # the frontend already greys this button out on your own row (see
        # the Users list), but the real enforcement has to live here too;
        # mirrored in purge below.
        if user.pk == request.user.pk:
            return Response({'detail': "You can't archive your own account."}, status=400)
        user.is_active = False
        user.archived_by = request.user
        user.archived_at = timezone.now()
        user.save(update_fields=['is_active', 'archived_by', 'archived_at'])
        return Response(status=204)

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        # See CourseViewSet.restore's comment: get_queryset() excludes
        # inactive (archived) users by default, so this bypasses it
        # deliberately — only someone with Archive tab access ever reaches
        # this (get_permissions), so there's no scoping being skipped that
        # actually matters.
        user = get_object_or_404(User, pk=pk)
        user.is_active = True
        user.archived_by = None
        user.archived_at = None
        user.save(update_fields=['is_active', 'archived_by', 'archived_at'])
        return Response(UserSerializer(user, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def purge(self, request, pk=None):
        # The real, final hard delete — only reachable from the Archive
        # page against an already-deactivated user. Unlike Course/Template,
        # this deliberately does NOT cascade-purge anything: a user who
        # owns real content (Course/Template.owner is PROTECT) stays
        # blocked, with an explicit message naming what they own, rather
        # than silently destroying courses/templates other people may still
        # have real attempt/submission history against. Checked against
        # `owner`, not `created_by` — owner is transferable (see
        # CourseViewSet/TemplateViewSet.transfer_ownership), so transferring
        # it away from this user unblocks the purge; created_by stays
        # permanent authorship history and, being its own separate PROTECT,
        # falls through to the generic ProtectedError handler below same as
        # any other remaining reference (e.g. the user's own CourseAttempt
        # history as a learner) would.
        user = get_object_or_404(User, pk=pk)
        if user.is_superuser:
            return Response({'detail': "The super-super-user account can't be archived or deleted."}, status=400)
        if user.is_platform_admin and not request.user.is_superuser:
            return Response({'detail': "Only the super-super-user can archive or delete a super user account."}, status=400)
        if user.pk == request.user.pk:
            return Response({'detail': "You can't delete your own account."}, status=400)
        if user.is_active:
            return Response({'detail': 'Only archived users can be permanently deleted.'}, status=400)
        # Named, not just counted — a bare "owns 2 course(s)" leaves the
        # admin with no idea which ones to go reassign. id+name is enough
        # for the frontend to link straight to each one's Members tab
        # (where ContentOwnershipCard's transfer control lives).
        owned_courses = list(Course.objects.filter(owner=user).values('id', 'name'))
        owned_templates = list(Template.objects.filter(owner=user).values('id', 'name'))
        if owned_courses or owned_templates:
            parts = []
            if owned_courses:
                parts.append(f'{len(owned_courses)} course(s)')
            if owned_templates:
                parts.append(f'{len(owned_templates)} template(s)')
            return Response(
                {
                    'detail': f"This user owns {' and '.join(parts)} — ownership must be reassigned "
                              "before this user can be permanently deleted.",
                    'owned_courses': owned_courses,
                    'owned_templates': owned_templates,
                },
                status=400,
            )
        # Any other PROTECT (e.g. the user's own CourseAttempt history as a
        # learner) propagates to apps/core/exceptions.py's global handler,
        # same as every other viewset's plain destroy() in this app.
        user.delete()
        return Response(status=204)

    @action(detail=True, methods=['post'], url_path='grant-platform-admin')
    def grant_platform_admin(self, request, pk=None):
        # The "super user" tier — full access to everything, but revocable
        # (unlike is_superuser), and only an is_superuser account can hand
        # it out (enforced by get_permissions above, not here) or take it
        # back (revoke_platform_admin below).
        user = get_object_or_404(User, pk=pk)
        user.is_platform_admin = True
        user.save(update_fields=['is_platform_admin'])
        return Response(UserSerializer(user, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='revoke-platform-admin')
    def revoke_platform_admin(self, request, pk=None):
        user = get_object_or_404(User, pk=pk)
        user.is_platform_admin = False
        user.save(update_fields=['is_platform_admin'])
        return Response(UserSerializer(user, context={'request': request}).data)


class TeamViewSet(viewsets.ModelViewSet):
    queryset = Team.objects.select_related('manager').all()
    serializer_class = TeamSerializer
    required_tab = 'users'

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [HasDashboardTabAccess()]
        return [IsAuthenticated()]


class GroupViewSet(viewsets.ModelViewSet):
    queryset = Group.objects.prefetch_related('courses', 'templates', 'members').all()
    serializer_class = GroupSerializer
    required_tab = 'groups'

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [HasDashboardTabAccess()]
        return [IsAuthenticated()]


class PermissionSetViewSet(viewsets.ModelViewSet):
    queryset = PermissionSet.objects.all()
    serializer_class = PermissionSetSerializer
    required_tab = 'permissions'

    def get_permissions(self):
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            # Any dashboard user can read the list of permission sets
            # (e.g. to show a readable name on a user's profile) — only
            # managing them requires the Permissions tab itself.
            return [IsAuthenticated()]
        return [HasDashboardTabAccess()]
