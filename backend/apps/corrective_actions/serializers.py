from rest_framework import serializers

from .models import CorrectiveAction


class CorrectiveActionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CorrectiveAction
        fields = [
            'id', 'answer', 'owner', 'description', 'due_date', 'status',
            'created_by', 'created_at', 'resolved_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'resolved_at']
