from rest_framework import serializers

from .models import Team, User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'team']
        read_only_fields = ['id']


class TeamSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = ['id', 'name', 'description', 'manager', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']
