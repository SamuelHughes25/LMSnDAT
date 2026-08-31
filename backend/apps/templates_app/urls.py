from rest_framework.routers import DefaultRouter

from .views import QuestionViewSet, SectionViewSet, TemplateVersionViewSet, TemplateViewSet

router = DefaultRouter()
router.register('templates', TemplateViewSet, basename='template')
router.register('template-versions', TemplateVersionViewSet, basename='template-version')
router.register('sections', SectionViewSet, basename='section')
router.register('questions', QuestionViewSet, basename='question')

urlpatterns = router.urls
