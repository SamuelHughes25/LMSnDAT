from rest_framework.routers import DefaultRouter

from .views import JobRoleViewSet, TeamViewSet, UserViewSet

router = DefaultRouter()
router.register('users', UserViewSet, basename='user')
router.register('teams', TeamViewSet, basename='team')
router.register('job-roles', JobRoleViewSet, basename='job-role')

urlpatterns = router.urls
