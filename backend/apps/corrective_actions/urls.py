from rest_framework.routers import DefaultRouter

from .views import CorrectiveActionViewSet

router = DefaultRouter()
router.register('corrective-actions', CorrectiveActionViewSet, basename='corrective-action')

urlpatterns = router.urls
