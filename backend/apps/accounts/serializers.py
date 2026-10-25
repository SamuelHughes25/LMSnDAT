from django.db.models import Q
from rest_framework import serializers

from apps.core.permissions import DASHBOARD_TABS, user_can_access_tab
from apps.courses.models import Course
from apps.templates_app.models import Template
from .models import Group, PermissionSet, Team, User


class UserSerializer(serializers.ModelSerializer):
    # Write-only: never echoed back in a response. Optional (not required)
    # so a PATCH that only changes e.g. content_groups doesn't have to
    # resend a password. ModelSerializer's default create()/update() would
    # otherwise assign this straight to the model field as plain text —
    # AbstractUser needs set_password() to actually hash it, so both are
    # overridden below.
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)
    archived_by_username = serializers.ReadOnlyField(source='archived_by.username')
    permission_set_name = serializers.ReadOnlyField(source='permission_set.name')
    # Computed, not a real field — which dashboard tabs this user can
    # currently reach, already accounting for is_superuser/is_platform_admin
    # bypassing tab checks entirely (same logic as
    # apps.core.permissions.user_can_access_tab, just precomputed here so
    # the frontend doesn't need a second round-trip to the user's
    # permission_set to build its own sidebar/page gating).
    accessible_tabs = serializers.SerializerMethodField()
    # Which specific courses/templates this user can open the builder for
    # purely via ownership/editor status, without the matching 'courses'/
    # 'templates' tab itself — lets the frontend show a scoped-down nav
    # link + list ("just this one course") for an office user who's been
    # made an editor but not handed the whole tab, instead of either the
    # full catalog or nothing. Only ever computed for the user fetching
    # their OWN row (obj.id == the requesting user's id) — a cheap id
    # comparison, no query — so this never turns the Users list page (one
    # row per user in the system) into an N+1; every other row's value is
    # an unconditional empty list. Mirrors user_can_edit_content's own
    # role=='member' cutoff: an operative's ownership/editor rows still
    # unlock nothing here, exactly as they unlock nothing in the real
    # builder-save permission check.
    manageable_course_ids = serializers.SerializerMethodField()
    manageable_template_ids = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'role', 'team',
            'content_groups', 'password', 'date_joined', 'is_active',
            'archived_by', 'archived_by_username', 'archived_at',
            'permission_set', 'permission_set_name', 'is_platform_admin', 'is_superuser', 'accessible_tabs',
            'manageable_course_ids', 'manageable_template_ids',
        ]
        # is_active/archived_by/archived_at are read-only here on purpose —
        # they should only ever change together, via UserViewSet's destroy/
        # restore actions, never through a raw PATCH that could drift them
        # out of sync with each other. is_platform_admin is read-only for
        # the identical reason — only UserViewSet's grant_platform_admin/
        # revoke_platform_admin actions touch it (and only an is_superuser
        # caller can even reach those). is_superuser is readable — the
        # frontend needs to know "is the CURRENT viewer the superuser" to
        # decide whether to show the grant/revoke-platform-admin control at
        # all (see /users/me/) — but it's unconditionally read-only, set
        # only once via a one-off shell command, never through this
        # serializer's create()/update() (both below are never even
        # given the chance to touch it, since it's in read_only_fields).
        read_only_fields = [
            'id', 'date_joined', 'is_active', 'archived_by', 'archived_by_username', 'archived_at', 'is_superuser',
            'permission_set_name', 'is_platform_admin', 'accessible_tabs',
            'manageable_course_ids', 'manageable_template_ids',
        ]

    def get_accessible_tabs(self, obj):
        return [tab for tab in DASHBOARD_TABS if user_can_access_tab(obj, tab)]

    def _is_self(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and request.user.id == obj.id)

    def get_manageable_course_ids(self, obj):
        if not self._is_self(obj) or obj.role == 'member':
            return []
        return list(
            Course.objects.filter(Q(owner=obj) | Q(editors=obj), is_archived=False)
            .values_list('id', flat=True)
            .distinct()
        )

    def get_manageable_template_ids(self, obj):
        if not self._is_self(obj) or obj.role == 'member':
            return []
        return list(
            Template.objects.filter(Q(owner=obj) | Q(editors=obj), is_archived=False)
            .values_list('id', flat=True)
            .distinct()
        )

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        # content_groups is M2M — can't be passed to the model constructor
        # (the instance needs a pk first), so pop it here and .set() it
        # after saving, same as DRF's own default ModelSerializer.update()
        # already does for M2M fields (that default is used as-is below;
        # only create() needed this fix since it's a custom override for
        # set_password()).
        content_groups = validated_data.pop('content_groups', None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        if content_groups is not None:
            user.content_groups.set(content_groups)
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        user = super().update(instance, validated_data)
        if password:
            user.set_password(password)
            user.save(update_fields=['password'])
        return user


class PermissionSetSerializer(serializers.ModelSerializer):
    class Meta:
        model = PermissionSet
        fields = [
            'id', 'name', 'can_access_templates', 'can_access_courses', 'can_access_users',
            'can_access_groups', 'can_access_permissions', 'can_access_archive', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class TeamSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = ['id', 'name', 'description', 'manager', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class GroupSerializer(serializers.ModelSerializer):
    # len(...all()) not .count() — the viewset's queryset already does
    # .prefetch_related('members'), and .count() would issue a fresh COUNT
    # query per group instead of using that prefetch cache.
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Group
        fields = ['id', 'name', 'description', 'courses', 'templates', 'member_count', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_member_count(self, obj):
        return len(obj.members.all())
