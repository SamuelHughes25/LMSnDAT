from rest_framework import serializers

from .constants import SlideType
from .models import Course, CourseAsset, CourseVersion, Lesson, Slide


class SlideSerializer(serializers.ModelSerializer):
    class Meta:
        model = Slide
        fields = ['id', 'lesson', 'slide_type', 'title', 'order', 'config']
        read_only_fields = ['id']

    def validate(self, attrs):
        lesson = attrs.get('lesson', getattr(self.instance, 'lesson', None))
        if lesson and lesson.course_version.status != CourseVersion.Status.DRAFT:
            raise serializers.ValidationError('Cannot modify slides on a non-draft course version.')

        slide_type = attrs.get('slide_type', getattr(self.instance, 'slide_type', None))
        config = attrs.get('config', getattr(self.instance, 'config', None) or {})

        if slide_type == SlideType.MULTIPLE_CHOICE:
            options = config.get('options')
            if not options or not isinstance(options, list):
                raise serializers.ValidationError(
                    {'config': 'multiple_choice slides require a non-empty "options" list.'}
                )
            if not any(isinstance(o, dict) and o.get('is_correct') for o in options):
                raise serializers.ValidationError(
                    {'config': 'multiple_choice slides require at least one option with "is_correct": true.'}
                )

        elif slide_type == SlideType.CATEGORIZE:
            buckets = config.get('buckets')
            items = config.get('items')
            if not buckets or not isinstance(buckets, list):
                raise serializers.ValidationError(
                    {'config': 'categorize slides require a non-empty "buckets" list.'}
                )
            if not items or not isinstance(items, list):
                raise serializers.ValidationError(
                    {'config': 'categorize slides require a non-empty "items" list.'}
                )
            bucket_ids = {b.get('id') for b in buckets if isinstance(b, dict)}
            for item in items:
                if not isinstance(item, dict) or item.get('correct_bucket_id') not in bucket_ids:
                    raise serializers.ValidationError(
                        {'config': 'every item must have a "correct_bucket_id" that references an existing bucket.'}
                    )

        return attrs


class LessonSerializer(serializers.ModelSerializer):
    slides = SlideSerializer(many=True, read_only=True)

    class Meta:
        model = Lesson
        fields = ['id', 'course_version', 'title', 'description', 'order', 'slides']
        read_only_fields = ['id']

    def validate(self, attrs):
        version = attrs.get('course_version', getattr(self.instance, 'course_version', None))
        if version and version.status != CourseVersion.Status.DRAFT:
            raise serializers.ValidationError('Cannot modify lessons on a non-draft course version.')
        return attrs


class CourseAssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseAsset
        fields = ['id', 'course_version', 'file', 'kind', 'uploaded_by', 'created_at']
        read_only_fields = ['id', 'uploaded_by', 'created_at']


class CourseVersionSerializer(serializers.ModelSerializer):
    lessons = LessonSerializer(many=True, read_only=True)
    assets = CourseAssetSerializer(many=True, read_only=True)

    class Meta:
        model = CourseVersion
        fields = [
            'id', 'course', 'version_number', 'status', 'transition_style', 'created_by',
            'published_at', 'created_at', 'lessons', 'assets',
        ]
        read_only_fields = ['id', 'version_number', 'status', 'created_by', 'published_at', 'created_at']

    def validate(self, attrs):
        if (
            'transition_style' in attrs
            and self.instance
            and self.instance.status != CourseVersion.Status.DRAFT
        ):
            raise serializers.ValidationError(
                {'transition_style': 'Cannot modify transition_style on a non-draft course version.'}
            )
        return attrs


class CourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = ['id', 'name', 'description', 'created_by', 'is_archived', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']
