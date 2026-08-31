from django.db.models import Q
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.accounts.models import User
from apps.core.permissions import IsAdminOrManager
from .models import Assignment
from .serializers import AssignmentSerializer


class AssignmentViewSet(viewsets.ModelViewSet):
    queryset = Assignment.objects.select_related('template_version__template', 'assigned_user', 'assigned_team')
    serializer_class = AssignmentSerializer

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAdminOrManager()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role == User.Role.ADMIN:
            return qs
        if user.role == User.Role.MANAGER:
            return qs.filter(Q(assigned_team=user.team) | Q(assigned_user__team=user.team))
        return qs.filter(Q(assigned_user=user) | Q(assigned_team=user.team))
