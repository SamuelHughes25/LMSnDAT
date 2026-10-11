from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.assignments.models import Assignment
from apps.core.permissions import (
    HasArchiveTabAccessOrIsOwner, HasDashboardTabAccess, IsContentOwnerEditorOrAdmin, IsContentOwnerOrAdmin, IsSuperuser,
    user_can_edit_content,
)
from apps.submissions.models import Answer, Submission
from . import services
from .models import Question, Section, Template, TemplateVersion
from .serializers import (
    QuestionSerializer, SectionSerializer, TemplateSerializer, TemplateVersionSerializer,
)


class TemplateViewSet(viewsets.ModelViewSet):
    queryset = Template.objects.all().prefetch_related('editors')
    serializer_class = TemplateSerializer
    required_tab = 'templates'

    def get_owning_content(self, obj):
        return obj

    def get_permissions(self):
        # Mirrors CourseViewSet.get_permissions exactly — see its comment,
        # including why reading stays open to any authenticated user.
        if self.action in ('update', 'partial_update', 'create_draft'):
            return [IsContentOwnerEditorOrAdmin()]
        if self.action == 'transfer_ownership':
            # Super-super-user only now — not the owner, not even someone
            # with the Templates tab. See IsSuperuser's own comment for why.
            return [IsSuperuser()]
        if self.action == 'set_editors':
            return [IsContentOwnerOrAdmin()]
        if self.action in ('destroy', 'restore', 'purge'):
            # Owner can always archive/restore/purge their own template
            # too, even with no Archive tab granted — see
            # HasArchiveTabAccessOrIsOwner's own comment.
            return [HasArchiveTabAccessOrIsOwner()]
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [HasDashboardTabAccess()]

    def get_queryset(self):
        # Mirrors CourseViewSet.get_queryset exactly — see its comment.
        qs = super().get_queryset()
        if self.request.query_params.get('archived') == 'true':
            qs = qs.filter(is_archived=True)
        else:
            qs = qs.filter(is_archived=False)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, owner=self.request.user)

    @action(detail=True, methods=['post'], url_path='transfer-ownership')
    def transfer_ownership(self, request, pk=None):
        # Mirrors CourseViewSet.transfer_ownership exactly.
        template = self.get_object()
        new_owner = User.objects.filter(pk=request.data.get('owner')).first()
        if not new_owner:
            return Response({'owner': 'Required and must reference an existing user.'}, status=400)
        template.owner = new_owner
        template.save(update_fields=['owner'])
        return Response(TemplateSerializer(template).data)

    @action(detail=True, methods=['post'], url_path='set-editors')
    def set_editors(self, request, pk=None):
        # Mirrors CourseViewSet.set_editors exactly.
        template = self.get_object()
        editor_ids = request.data.get('editors', [])
        if not isinstance(editor_ids, list):
            return Response({'editors': 'Must be a list of user ids.'}, status=400)
        template.editors.set(User.objects.filter(pk__in=editor_ids))
        return Response(TemplateSerializer(template).data)

    def destroy(self, request, *args, **kwargs):
        # Mirrors CourseViewSet.destroy exactly — see its comment.
        template = self.get_object()
        template.is_archived = True
        template.archived_by = request.user
        template.archived_at = timezone.now()
        template.save(update_fields=['is_archived', 'archived_by', 'archived_at'])
        return Response(status=204)

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        # See CourseViewSet.restore's comment: get_queryset() excludes
        # archived rows by default, so this bypasses it deliberately —
        # and, same as there, that means check_object_permissions has to
        # be called explicitly for HasArchiveTabAccessOrIsOwner's owner
        # check to ever actually run.
        template = get_object_or_404(Template, pk=pk)
        self.check_object_permissions(request, template)
        template.is_archived = False
        template.archived_by = None
        template.archived_at = None
        template.save(update_fields=['is_archived', 'archived_by', 'archived_at'])
        return Response(TemplateSerializer(template).data)

    @action(detail=True, methods=['post'])
    def purge(self, request, pk=None):
        # The real, final hard delete — only reachable from the Archive
        # page against an already-archived template. Three PROTECT points
        # stand between a Template and deletion: Assignment.template_version,
        # Submission.template_version, and Answer.question — confirmed no
        # other model protects a Template-owned row. Order matters: Answer
        # first (unblocks Question, which cascades from Section/
        # TemplateVersion/Template), then Submission (nothing protects it,
        # and leaving it until after Answer avoids any FK ordering surprise),
        # then Assignment (unblocks TemplateVersion; Submission.assignment is
        # itself PROTECT, so Submissions must already be gone before this),
        # then template.delete() cascades TemplateVersion -> Section ->
        # Question cleanly.
        template = get_object_or_404(Template, pk=pk)
        self.check_object_permissions(request, template)
        if not template.is_archived:
            return Response({'detail': 'Only archived templates can be permanently deleted.'}, status=400)
        versions = template.versions.all()
        with transaction.atomic():
            Answer.objects.filter(question__section__template_version__in=versions).delete()
            Submission.objects.filter(template_version__in=versions).delete()
            Assignment.objects.filter(template_version__in=versions).delete()
            template.delete()
        return Response(status=204)

    @action(detail=True, methods=['post'], url_path='create-draft')
    def create_draft(self, request, pk=None):
        template = self.get_object()
        version = services.create_draft_version(template, request.user)
        return Response(TemplateVersionSerializer(version).data, status=201)


class TemplateVersionViewSet(viewsets.ModelViewSet):
    queryset = TemplateVersion.objects.select_related('template').prefetch_related('sections__questions')
    serializer_class = TemplateVersionSerializer
    permission_classes = [IsContentOwnerEditorOrAdmin]
    required_tab = 'templates'

    def get_owning_content(self, obj):
        return obj.template

    def get_queryset(self):
        qs = super().get_queryset()
        template_id = self.request.query_params.get('template')
        if template_id:
            qs = qs.filter(template_id=template_id)
        return qs

    def perform_create(self, serializer):
        # has_object_permission only fires once an instance exists — see
        # apps.courses.views.CourseVersionViewSet.perform_create's identical
        # comment.
        template = serializer.validated_data['template']
        if not user_can_edit_content(self.request.user, template, self.required_tab):
            raise PermissionDenied("You don't have edit access to this template.")
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        version = self.get_object()
        published = services.publish_version(version, request.user)
        return Response(TemplateVersionSerializer(published).data)


class SectionViewSet(viewsets.ModelViewSet):
    queryset = Section.objects.all()
    serializer_class = SectionSerializer
    permission_classes = [IsContentOwnerEditorOrAdmin]
    required_tab = 'templates'

    def get_owning_content(self, obj):
        return obj.template_version.template

    def get_queryset(self):
        qs = super().get_queryset()
        version_id = self.request.query_params.get('template_version')
        if version_id:
            qs = qs.filter(template_version_id=version_id)
        return qs

    def perform_create(self, serializer):
        template = serializer.validated_data['template_version'].template
        if not user_can_edit_content(self.request.user, template, self.required_tab):
            raise PermissionDenied("You don't have edit access to this template.")
        serializer.save()


class QuestionViewSet(viewsets.ModelViewSet):
    queryset = Question.objects.all()
    serializer_class = QuestionSerializer
    permission_classes = [IsContentOwnerEditorOrAdmin]
    required_tab = 'templates'

    def get_owning_content(self, obj):
        return obj.section.template_version.template

    def get_queryset(self):
        qs = super().get_queryset()
        section_id = self.request.query_params.get('section')
        if section_id:
            qs = qs.filter(section_id=section_id)
        return qs

    def perform_create(self, serializer):
        template = serializer.validated_data['section'].template_version.template
        if not user_can_edit_content(self.request.user, template, self.required_tab):
            raise PermissionDenied("You don't have edit access to this template.")
        serializer.save()
