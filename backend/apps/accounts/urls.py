from rest_framework.routers import DefaultRouter

from .views import GroupViewSet, PermissionSetViewSet, TeamViewSet, UserViewSet

router = DefaultRouter()
router.register('users', UserViewSet, basename='user')
router.register('teams', TeamViewSet, basename='team')
router.register('groups', GroupViewSet, basename='group')
router.register('permission-sets', PermissionSetViewSet, basename='permissionset')

urlpatterns = router.urls
