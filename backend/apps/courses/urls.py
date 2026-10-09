from rest_framework.routers import DefaultRouter

from .views import (
    CourseAssetViewSet, CourseAssignmentViewSet, CourseAttemptViewSet, CourseDeadlineExtensionViewSet,
    CourseVersionViewSet, CourseViewSet, LessonViewSet, ReusableLessonViewSet, SlideViewSet,
)

router = DefaultRouter()
router.register('courses', CourseViewSet, basename='course')
router.register('course-versions', CourseVersionViewSet, basename='course-version')
router.register('lessons', LessonViewSet, basename='lesson')
router.register('slides', SlideViewSet, basename='slide')
router.register('course-assets', CourseAssetViewSet, basename='course-asset')
router.register('course-attempts', CourseAttemptViewSet, basename='course-attempt')
router.register('course-deadline-extensions', CourseDeadlineExtensionViewSet, basename='course-deadline-extension')
router.register('reusable-lessons', ReusableLessonViewSet, basename='reusable-lesson')
router.register('course-assignments', CourseAssignmentViewSet, basename='course-assignment')

urlpatterns = router.urls
