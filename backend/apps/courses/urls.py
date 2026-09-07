from rest_framework.routers import DefaultRouter

from .views import (
    CourseAssetViewSet, CourseAttemptViewSet, CourseVersionViewSet, CourseViewSet, LessonViewSet, SlideViewSet,
)

router = DefaultRouter()
router.register('courses', CourseViewSet, basename='course')
router.register('course-versions', CourseVersionViewSet, basename='course-version')
router.register('lessons', LessonViewSet, basename='lesson')
router.register('slides', SlideViewSet, basename='slide')
router.register('course-assets', CourseAssetViewSet, basename='course-asset')
router.register('course-attempts', CourseAttemptViewSet, basename='course-attempt')

urlpatterns = router.urls
