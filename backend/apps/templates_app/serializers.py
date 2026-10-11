from rest_framework import serializers

from .constants import SELECT_TYPES
from .models import Question, Section, Template, TemplateVersion


class QuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Question
        fields = [
            'id', 'section', 'question_type', 'label', 'help_text', 'order',
            'is_required', 'config', 'display_logic', 'flag_rule',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        section = attrs.get('section', getattr(self.instance, 'section', None))
        if section and section.template_version.status != TemplateVersion.Status.DRAFT:
            raise serializers.ValidationError('Cannot modify questions on a non-draft template version.')

        question_type = attrs.get('question_type', getattr(self.instance, 'question_type', None))
        config = attrs.get('config', getattr(self.instance, 'config', None) or {})
        if question_type in SELECT_TYPES:
            options = config.get('options')
            if not options or not isinstance(options, list):
                raise serializers.ValidationError(
                    {'config': 'select questions require a non-empty "options" list.'}
                )

        display_logic = attrs.get('display_logic', getattr(self.instance, 'display_logic', None))
        if display_logic:
            ref_id = display_logic.get('question_id')
            if not ref_id:
                raise serializers.ValidationError({'display_logic': 'display_logic requires a "question_id".'})
            if section and not Question.objects.filter(pk=ref_id, section__template_version=section.template_version).exists():
                raise serializers.ValidationError(
                    {'display_logic': 'question_id must reference a question in the same template version.'}
                )

        return attrs


class SectionSerializer(serializers.ModelSerializer):
    questions = QuestionSerializer(many=True, read_only=True)

    class Meta:
        model = Section
        fields = ['id', 'template_version', 'title', 'description', 'order', 'questions']
        read_only_fields = ['id']

    def validate(self, attrs):
        version = attrs.get('template_version', getattr(self.instance, 'template_version', None))
        if version and version.status != TemplateVersion.Status.DRAFT:
            raise serializers.ValidationError('Cannot modify sections on a non-draft template version.')
        return attrs


class TemplateVersionSerializer(serializers.ModelSerializer):
    sections = SectionSerializer(many=True, read_only=True)

    class Meta:
        model = TemplateVersion
        fields = [
            'id', 'template', 'version_number', 'status', 'created_by',
            'published_at', 'created_at', 'sections',
        ]
        read_only_fields = ['id', 'version_number', 'status', 'created_by', 'published_at', 'created_at']


class TemplateSerializer(serializers.ModelSerializer):
    archived_by_username = serializers.ReadOnlyField(source='archived_by.username')
    owner_username = serializers.ReadOnlyField(source='owner.username')
    # See CourseSerializer's identical field for the full reasoning — the
    # one durable "who made this" record transfer_ownership never touches.
    created_by_username = serializers.ReadOnlyField(source='created_by.username')
    editor_usernames = serializers.SerializerMethodField()

    class Meta:
        model = Template
        fields = [
            'id', 'name', 'description', 'created_by', 'created_by_username', 'is_archived',
            'archived_by', 'archived_by_username', 'archived_at',
            'owner', 'owner_username', 'editors', 'editor_usernames', 'created_at', 'updated_at',
        ]
        # See CourseSerializer's identical comment: these only ever change
        # together, via TemplateViewSet's destroy/restore/purge/
        # transfer_ownership/set_editors actions.
        read_only_fields = [
            'id', 'created_by', 'created_by_username', 'created_at', 'updated_at',
            'is_archived', 'archived_by', 'archived_by_username', 'archived_at',
            'owner', 'owner_username', 'editors', 'editor_usernames',
        ]

    def get_editor_usernames(self, obj):
        return [u.username for u in obj.editors.all()]
