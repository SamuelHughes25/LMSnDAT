from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.core.permissions import IsAdminOrReadOnly
from . import services
from .models import Course, CourseAsset, CourseAttempt, CourseVersion, Lesson, Slide, SlideResult
from .serializers import (
    CourseAssetSerializer, CourseAttemptSerializer, CourseSerializer, CourseVersionSerializer,
    LessonSerializer, SlideResultBulkUpsertSerializer, SlideResultSerializer, SlideSerializer,
)


class CourseViewSet(viewsets.ModelViewSet):
    queryset = Course.objects.all()
    serializer_class = CourseSerializer
    permission_classes = [IsAdminOrReadOnly]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='create-draft')
    def create_draft(self, request, pk=None):
        course = self.get_object()
        version = services.create_draft_version(course, request.user)
        return Response(CourseVersionSerializer(version).data, status=201)


class CourseVersionViewSet(viewsets.ModelViewSet):
    queryset = CourseVersion.objects.select_related('course').prefetch_related('lessons__slides', 'assets')
    serializer_class = CourseVersionSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        course_id = self.request.query_params.get('course')
        if course_id:
            qs = qs.filter(course_id=course_id)
        return qs

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        version = self.get_object()
        published = services.publish_version(version, request.user)
        return Response(CourseVersionSerializer(published).data)


class LessonViewSet(viewsets.ModelViewSet):
    queryset = Lesson.objects.all()
    serializer_class = LessonSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        version_id = self.request.query_params.get('course_version')
        if version_id:
            qs = qs.filter(course_version_id=version_id)
        return qs


class SlideViewSet(viewsets.ModelViewSet):
    queryset = Slide.objects.all()
    serializer_class = SlideSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        lesson_id = self.request.query_params.get('lesson')
        if lesson_id:
            qs = qs.filter(lesson_id=lesson_id)
        return qs


class CourseAssetViewSet(viewsets.ModelViewSet):
    queryset = CourseAsset.objects.all()
    serializer_class = CourseAssetSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        version_id = self.request.query_params.get('course_version')
        if version_id:
            qs = qs.filter(course_version_id=version_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


class CourseAttemptViewSet(viewsets.ModelViewSet):
    queryset = CourseAttempt.objects.select_related('course_version__course', 'user').prefetch_related(
        'slide_results'
    )
    serializer_class = CourseAttemptSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role == User.Role.ADMIN:
            pass
        elif user.role == User.Role.MANAGER:
            qs = qs.filter(user__team=user.team)
        else:
            qs = qs.filter(user=user)

        course_id = self.request.query_params.get('course')
        if course_id:
            qs = qs.filter(course_version__course_id=course_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=True, methods=['post'])
    def results(self, request, pk=None):
        attempt = self.get_object()
        serializer = SlideResultBulkUpsertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        saved = []
        with transaction.atomic():
            for item in serializer.validated_data['results']:
                result, _ = SlideResult.objects.update_or_create(
                    attempt=attempt,
                    slide_id=item['slide'],
                    defaults={'detail': item.get('detail')},
                )
                saved.append(result)

        return Response(SlideResultSerializer(saved, many=True).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        attempt = self.get_object()
        scores = list(attempt.slide_results.values_list('score', flat=True))
        score = round(sum(scores) / len(scores) * 100) if scores else None

        course = attempt.course_version.course
        passed = None
        if course.is_assessment and course.passing_score is not None and score is not None:
            passed = score >= course.passing_score

        attempt.status = CourseAttempt.Status.COMPLETED
        attempt.completed_at = timezone.now()
        attempt.score = score
        attempt.passed = passed
        attempt.save(update_fields=['status', 'completed_at', 'score', 'passed'])

        return Response(CourseAttemptSerializer(attempt).data)
