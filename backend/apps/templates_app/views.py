from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsAdminOrReadOnly
from . import services
from .models import Question, Section, Template, TemplateVersion
from .serializers import (
    QuestionSerializer, SectionSerializer, TemplateSerializer, TemplateVersionSerializer,
)


class TemplateViewSet(viewsets.ModelViewSet):
    queryset = Template.objects.all()
    serializer_class = TemplateSerializer
    permission_classes = [IsAdminOrReadOnly]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='create-draft')
    def create_draft(self, request, pk=None):
        template = self.get_object()
        version = services.create_draft_version(template, request.user)
        return Response(TemplateVersionSerializer(version).data, status=201)


class TemplateVersionViewSet(viewsets.ModelViewSet):
    queryset = TemplateVersion.objects.select_related('template').prefetch_related('sections__questions')
    serializer_class = TemplateVersionSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        template_id = self.request.query_params.get('template')
        if template_id:
            qs = qs.filter(template_id=template_id)
        return qs

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        version = self.get_object()
        published = services.publish_version(version, request.user)
        return Response(TemplateVersionSerializer(published).data)


class SectionViewSet(viewsets.ModelViewSet):
    queryset = Section.objects.all()
    serializer_class = SectionSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        version_id = self.request.query_params.get('template_version')
        if version_id:
            qs = qs.filter(template_version_id=version_id)
        return qs


class QuestionViewSet(viewsets.ModelViewSet):
    queryset = Question.objects.all()
    serializer_class = QuestionSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        section_id = self.request.query_params.get('section')
        if section_id:
            qs = qs.filter(section_id=section_id)
        return qs
