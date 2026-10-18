from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
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
        answers = serializer.validated_data['answers']

        # Every submitted `question` id must actually belong to THIS
        # submission's own template_version — Question.evaluate_flag() is
        # already server-computed (tamper-proof for a GIVEN question), but
        # without this check nothing stopped an Answer being created
        # against a question from an entirely DIFFERENT template, and a
        # bare `Question.objects.get()` on a well-formed-but-nonexistent
        # id raised an unhandled DoesNotExist (a 500) instead of a clean
        # 400 — same two-part fix as apps.courses's results() endpoint
        # (see its own comment for the full reasoning). One query up
        # front rather than a get() per item in the loop below.
        question_ids = {item['question'] for item in answers}
        valid_question_ids = set(
            Question.objects.filter(
                id__in=question_ids, section__template_version_id=submission.template_version_id,
            ).values_list('id', flat=True)
        )
        invalid_ids = question_ids - valid_question_ids
        if invalid_ids:
            raise ValidationError({
                'answers': f"Question(s) {', '.join(str(i) for i in invalid_ids)} are not part of this submission's template.",
            })

        saved = []
        with transaction.atomic():
            questions_by_id = {q.id: q for q in Question.objects.filter(id__in=question_ids)}
            for item in answers:
                question = questions_by_id[item['question']]
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
