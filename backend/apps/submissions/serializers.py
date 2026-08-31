from rest_framework import serializers

from .models import Answer, Attachment, Submission


class AttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = ['id', 'answer', 'file', 'kind', 'uploaded_by', 'created_at']
        read_only_fields = ['id', 'uploaded_by', 'created_at']


class AnswerSerializer(serializers.ModelSerializer):
    attachments = AttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = Answer
        fields = ['id', 'submission', 'question', 'value', 'requires_action', 'attachments']
        read_only_fields = ['id', 'requires_action']


class SubmissionSerializer(serializers.ModelSerializer):
    answers = AnswerSerializer(many=True, read_only=True)

    class Meta:
        model = Submission
        fields = [
            'id', 'assignment', 'template_version', 'submitted_by', 'status',
            'started_at', 'submitted_at', 'answers',
        ]
        # template_version is derived server-side from assignment.template_version
        # (see SubmissionViewSet.perform_create) — never trust the client for this.
        read_only_fields = ['id', 'template_version', 'submitted_by', 'status', 'started_at', 'submitted_at']


class AnswerUpsertSerializer(serializers.Serializer):
    question = serializers.UUIDField()
    value = serializers.JSONField(required=False, allow_null=True)


class AnswerBulkUpsertSerializer(serializers.Serializer):
    answers = AnswerUpsertSerializer(many=True)
