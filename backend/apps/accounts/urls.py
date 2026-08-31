from rest_framework.routers import DefaultRouter

from .views import TeamViewSet, UserViewSet

router = DefaultRouter()
router.register('users', UserViewSet, basename='user')
router.register('teams', TeamViewSet, basename='team')

urlpatterns = router.urls
