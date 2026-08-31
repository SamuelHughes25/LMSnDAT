from rest_framework.routers import DefaultRouter

from .views import AttachmentViewSet, SubmissionViewSet

router = DefaultRouter()
router.register('submissions', SubmissionViewSet, basename='submission')
router.register('attachments', AttachmentViewSet, basename='attachment')

urlpatterns = router.urls
