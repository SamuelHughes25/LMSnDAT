from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsAdmin
from .models import JobRole, Team, User
from .serializers import JobRoleSerializer, TeamSerializer, UserSerializer


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related('team', 'job_role').all()
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
            pass
        elif user.role == User.Role.MANAGER:
            qs = qs.filter(team=user.team)
        else:
            qs = qs.filter(pk=user.pk)

        # Manual query-param filtering (search-by-username, filter-by-
        # job_role) applied on TOP of the role-scoping above, matching this
        # codebase's existing "no django-filter, just get_queryset()" style
        # used elsewhere for parent-scoping (e.g. ?course= on child
        # viewsets) — there's no SearchFilter/DjangoFilterBackend anywhere
        # in this project to introduce a new dependency for.
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(username__icontains=search)
        job_role = self.request.query_params.get('job_role')
        if job_role:
            qs = qs.filter(job_role=job_role)
        return qs


class TeamViewSet(viewsets.ModelViewSet):
    queryset = Team.objects.select_related('manager').all()
    serializer_class = TeamSerializer

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAdmin()]
        return [IsAuthenticated()]


class JobRoleViewSet(viewsets.ModelViewSet):
    queryset = JobRole.objects.prefetch_related('courses', 'templates').all()
    serializer_class = JobRoleSerializer

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAdmin()]
        return [IsAuthenticated()]
