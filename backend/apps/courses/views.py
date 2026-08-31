from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsAdminOrReadOnly
from . import services
from .models import Course, CourseAsset, CourseVersion, Lesson, Slide
from .serializers import (
    CourseAssetSerializer, CourseSerializer, CourseVersionSerializer, LessonSerializer, SlideSerializer,
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
