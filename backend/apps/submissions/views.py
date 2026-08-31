from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.models import User
from apps.templates_app.models import Question
from .models import Answer, Attachment, Submission
from .serializers import (
    AnswerBulkUpsertSerializer, AnswerSerializer, AttachmentSerializer, SubmissionSerializer,
)


class SubmissionViewSet(viewsets.ModelViewSet):
    queryset = Submission.objects.select_related(
        'assignment', 'template_version', 'submitted_by'
    ).prefetch_related('answers__attachments')
    serializer_class = SubmissionSerializer

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role == User.Role.ADMIN:
            return qs
        if user.role == User.Role.MANAGER:
            return qs.filter(submitted_by__team=user.team) | qs.filter(submitted_by=user)
        return qs.filter(submitted_by=user)

    def perform_create(self, serializer):
        assignment = serializer.validated_data['assignment']
        serializer.save(submitted_by=self.request.user, template_version=assignment.template_version)

    @action(detail=True, methods=['post'])
    def answers(self, request, pk=None):
        submission = self.get_object()
        serializer = AnswerBulkUpsertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        saved = []
        with transaction.atomic():
            for item in serializer.validated_data['answers']:
                question = Question.objects.get(pk=item['question'])
                answer, _ = Answer.objects.update_or_create(
                    submission=submission,
                    question=question,
                    defaults={'value': item.get('value')},
                )
                saved.append(answer)

        return Response(AnswerSerializer(saved, many=True).data)

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        submission = self.get_object()
        submission.status = Submission.Status.SUBMITTED
        submission.submitted_at = timezone.now()
        submission.save(update_fields=['status', 'submitted_at'])

        submission.assignment.status = submission.assignment.Status.COMPLETE
        submission.assignment.save(update_fields=['status'])

        return Response(SubmissionSerializer(submission).data)


class AttachmentViewSet(viewsets.ModelViewSet):
    queryset = Attachment.objects.all()
    serializer_class = AttachmentSerializer

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)
