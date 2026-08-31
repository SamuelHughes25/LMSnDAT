from django.utils import timezone
from rest_framework import viewsets

from apps.accounts.models import User
from .models import CorrectiveAction
from .serializers import CorrectiveActionSerializer


class CorrectiveActionViewSet(viewsets.ModelViewSet):
    queryset = CorrectiveAction.objects.select_related('answer', 'owner')
    serializer_class = CorrectiveActionSerializer

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role == User.Role.ADMIN:
            return qs
        if user.role == User.Role.MANAGER:
            return qs.filter(owner__team=user.team)
        return qs.filter(owner=user)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        instance = serializer.save()
        if instance.status == CorrectiveAction.Status.RESOLVED and not instance.resolved_at:
            instance.resolved_at = timezone.now()
            instance.save(update_fields=['resolved_at'])
