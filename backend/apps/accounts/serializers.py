from rest_framework import serializers

from .models import Group, Team, User


class UserSerializer(serializers.ModelSerializer):
    # Write-only: never echoed back in a response. Optional (not required)
    # so a PATCH that only changes e.g. content_groups doesn't have to
    # resend a password. ModelSerializer's default create()/update() would
    # otherwise assign this straight to the model field as plain text —
    # AbstractUser needs set_password() to actually hash it, so both are
    # overridden below.
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'role', 'team',
            'content_groups', 'password', 'date_joined',
        ]
        read_only_fields = ['id', 'date_joined']

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
