from rest_framework import serializers

from .models import JobRole, Team, User


class UserSerializer(serializers.ModelSerializer):
    # Write-only: never echoed back in a response. Optional (not required)
    # so a PATCH that only changes e.g. job_role doesn't have to resend a
    # password. ModelSerializer's default create()/update() would otherwise
    # assign this straight to the model field as plain text — AbstractUser
    # needs set_password() to actually hash it, so both are overridden below.
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'role', 'team', 'job_role',
            'password', 'date_joined',
        ]
        read_only_fields = ['id', 'date_joined']

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
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


class JobRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobRole
        fields = ['id', 'name', 'description', 'courses', 'templates', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']
