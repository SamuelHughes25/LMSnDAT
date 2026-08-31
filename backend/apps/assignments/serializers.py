from rest_framework import serializers

from .models import Assignment


class AssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Assignment
        fields = [
            'id', 'template_version', 'assigned_user', 'assigned_team', 'due_date',
            'recurrence_rule', 'recurrence_parent', 'status', 'created_by', 'created_at',
        ]
        read_only_fields = ['id', 'recurrence_parent', 'status', 'created_by', 'created_at']

    def validate(self, attrs):
        user = attrs.get('assigned_user', getattr(self.instance, 'assigned_user', None))
        team = attrs.get('assigned_team', getattr(self.instance, 'assigned_team', None))
        if bool(user) == bool(team):
            raise serializers.ValidationError('Assign to exactly one of assigned_user or assigned_team.')
        return attrs
