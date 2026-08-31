from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsAdmin
from .models import Team, User
from .serializers import TeamSerializer, UserSerializer


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related('team').all()
    serializer_class = UserSerializer

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAdmin()]
        return [IsAuthenticated()]

    @action(detail=False, methods=['get'])
    def me(self, request):
        return Response(UserSerializer(request.user).data)

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role == User.Role.ADMIN:
            return qs
        if user.role == User.Role.MANAGER:
            return qs.filter(team=user.team)
        return qs.filter(pk=user.pk)


class TeamViewSet(viewsets.ModelViewSet):
    queryset = Team.objects.select_related('manager').all()
    serializer_class = TeamSerializer

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAdmin()]
        return [IsAuthenticated()]
