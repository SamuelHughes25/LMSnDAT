from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.core.permissions import IsAdminOrManager, IsAdminOrManagerOrReadOnly, IsAdminOrReadOnly
from . import services
from .models import (
    Course, CourseAsset, CourseAssignment, CourseAttempt, CourseDeadlineExtension, CourseVersion, Lesson,
    ReusableLesson, Slide, SlideResult,
)
from .serializers import (
    CourseAssetSerializer, CourseAssignmentSerializer, CourseAttemptSerializer, CourseDeadlineExtensionSerializer,
    CourseSerializer, CourseVersionSerializer, LessonSerializer, ReusableLessonSerializer,
    SlideResultBulkUpsertSerializer, SlideResultSerializer, SlideSerializer,
)


class CourseViewSet(viewsets.ModelViewSet):
    queryset = Course.objects.all()
    serializer_class = CourseSerializer
    permission_classes = [IsAdminOrReadOnly]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='create-draft')
    def create_draft(self, request, pk=None):
        course = self.get_object()
        version = services.create_draft_version(course, request.user)
        return Response(CourseVersionSerializer(version).data, status=201)


class CourseVersionViewSet(viewsets.ModelViewSet):
    queryset = CourseVersion.objects.select_related('course').prefetch_related('lessons__slides', 'assets')
    serializer_class = CourseVersionSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        course_id = self.request.query_params.get('course')
        if course_id:
            qs = qs.filter(course_id=course_id)
        return qs

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        version = self.get_object()
        published = services.publish_version(version, request.user)
        return Response(CourseVersionSerializer(published).data)


class LessonViewSet(viewsets.ModelViewSet):
    queryset = Lesson.objects.all()
    serializer_class = LessonSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        version_id = self.request.query_params.get('course_version')
        if version_id:
            qs = qs.filter(course_version_id=version_id)
        return qs

    @action(detail=True, methods=['post'], url_path='save-as-reusable')
    def save_as_reusable(self, request, pk=None):
        lesson = self.get_object()
        name = request.data.get('name') or lesson.title
        description = request.data.get('description', '')
        reusable_lesson = services.save_lesson_as_reusable(lesson, name, description, request.user)
        return Response(ReusableLessonSerializer(reusable_lesson).data, status=201)


class ReusableLessonViewSet(viewsets.ModelViewSet):
    """The saved-lesson library — see ReusableLesson's own docstring. Entries
    are only ever created via LessonViewSet.save_as_reusable above (cloning
    an existing authored lesson), never directly through this viewset's own
    create, so this intentionally has no custom perform_create; standard
    list/retrieve/destroy cover the manage/import dialog's needs."""

    queryset = ReusableLesson.objects.all()
    serializer_class = ReusableLessonSerializer
    permission_classes = [IsAdminOrReadOnly]

    @action(detail=True, methods=['post'], url_path='import')
    def import_into(self, request, pk=None):
        reusable_lesson = self.get_object()
        version_id = request.data.get('course_version')
        target_version = CourseVersion.objects.filter(id=version_id).first()
        if not target_version:
            return Response({'course_version': 'Required and must reference an existing course version.'}, status=400)
        if target_version.status != CourseVersion.Status.DRAFT:
            return Response({'course_version': 'Can only import into a draft course version.'}, status=400)
        order = request.data.get('order', 0)
        new_lesson = services.import_reusable_lesson(reusable_lesson, target_version, order)
        return Response(LessonSerializer(new_lesson).data, status=201)


class SlideViewSet(viewsets.ModelViewSet):
    queryset = Slide.objects.all()
    serializer_class = SlideSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        lesson_id = self.request.query_params.get('lesson')
        if lesson_id:
            qs = qs.filter(lesson_id=lesson_id)
        return qs


class CourseAssetViewSet(viewsets.ModelViewSet):
    queryset = CourseAsset.objects.all()
    serializer_class = CourseAssetSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        version_id = self.request.query_params.get('course_version')
        if version_id:
            qs = qs.filter(course_version_id=version_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


class CourseAttemptViewSet(viewsets.ModelViewSet):
    queryset = CourseAttempt.objects.select_related('course_version__course', 'user').prefetch_related(
        'slide_results'
    )
    serializer_class = CourseAttemptSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role == User.Role.ADMIN:
            pass
        elif user.role == User.Role.MANAGER:
            qs = qs.filter(user__team=user.team)
        else:
            qs = qs.filter(user=user)

        course_id = self.request.query_params.get('course')
        if course_id:
            qs = qs.filter(course_version__course_id=course_id)
        # Used by the user detail page's cross-course history section —
        # every attempt for ONE user across every course, as opposed to
        # ?course= above (one course's own analytics, across every user).
        # Already scoped to "users I'm allowed to see" by the role-scoping
        # above, so a manager can't pull another team's user's history this
        # way either.
        user_id = self.request.query_params.get('user')
        if user_id:
            qs = qs.filter(user_id=user_id)
        # Used by the course player to find an existing in_progress attempt
        # to RESUME on mount, instead of always starting a brand-new one
        # (see course-preview-viewer.tsx's startAttempt) — already scoped to
        # "my own attempts only" for a member by the role-scoping above, so
        # this can never surface another user's in-progress attempt.
        course_version_id = self.request.query_params.get('course_version')
        if course_version_id:
            qs = qs.filter(course_version_id=course_version_id)
        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)
        return qs

    def perform_create(self, serializer):
        # RESUMES an existing in_progress attempt at this course version
        # instead of always creating a new one — confirmed via a real
        # browser that without this, ordinary back-and-forth browsing (or,
        # in dev, React Strict Mode's double-invoked mount effect) produced
        # a pile of abandoned in_progress rows, one per visit. The
        # check-then-create here still has a genuine race window between two
        # truly concurrent requests (two tabs opened at once, or Strict
        # Mode's near-simultaneous double call) — the IntegrityError catch
        # below, backed by the DB-level UniqueConstraint in CourseAttempt.Meta,
        # is what actually closes that window: whichever request loses the
        # race just resumes the winner's row instead of erroring.
        user = self.request.user
        course_version = serializer.validated_data['course_version']
        existing = CourseAttempt.objects.filter(
            user=user, course_version=course_version, status=CourseAttempt.Status.IN_PROGRESS,
        ).order_by('-started_at').first()
        if existing:
            serializer.instance = existing
            return
        try:
            with transaction.atomic():
                serializer.save(user=user)
        except IntegrityError:
            serializer.instance = CourseAttempt.objects.get(
                user=user, course_version=course_version, status=CourseAttempt.Status.IN_PROGRESS,
            )

    @action(detail=True, methods=['post'])
    def results(self, request, pk=None):
        attempt = self.get_object()
        serializer = SlideResultBulkUpsertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        saved = []
        with transaction.atomic():
            for item in serializer.validated_data['results']:
                result, _ = SlideResult.objects.update_or_create(
                    attempt=attempt,
                    slide_id=item['slide'],
                    defaults={'detail': item.get('detail')},
                )
                saved.append(result)

        return Response(SlideResultSerializer(saved, many=True).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        attempt = self.get_object()
        scores = list(attempt.slide_results.values_list('score', flat=True))
        score = round(sum(scores) / len(scores) * 100) if scores else None

        course = attempt.course_version.course
        passed = None
        if course.is_assessment and course.passing_score is not None and score is not None:
            passed = score >= course.passing_score

        attempt.status = CourseAttempt.Status.COMPLETED
        attempt.completed_at = timezone.now()
        attempt.score = score
        attempt.passed = passed
        attempt.save(update_fields=['status', 'completed_at', 'score', 'passed'])

        return Response(CourseAttemptSerializer(attempt).data)


class CourseDeadlineExtensionViewSet(viewsets.ModelViewSet):
    """The "this one person needs more time" escape hatch for a course's
    default deadline — see Course.effective_deadline_for(). Members never
    touch this endpoint directly; it's admin/manager tooling, surfaced from
    the course's own per-user analytics table."""

    queryset = CourseDeadlineExtension.objects.select_related('course', 'user')
    serializer_class = CourseDeadlineExtensionSerializer
    permission_classes = [IsAdminOrManager]

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role != User.Role.ADMIN:
            qs = qs.filter(user__team=user.team)

        course_id = self.request.query_params.get('course')
        if course_id:
            qs = qs.filter(course_id=course_id)
        target_user_id = self.request.query_params.get('user')
        if target_user_id:
            qs = qs.filter(user_id=target_user_id)
        return qs

    def perform_create(self, serializer):
        # get_queryset's team-scoping only protects reads/updates/deletes of
        # EXISTING rows — a manager POSTing a brand-new extension for an
        # arbitrary user id isn't filtered by that at all, so it needs its
        # own check here.
        requester = self.request.user
        target_user = serializer.validated_data['user']
        if requester.role != User.Role.ADMIN and target_user.team != requester.team:
            raise PermissionDenied("Cannot set a deadline extension for a user outside your team.")
        serializer.save()


class CourseAssignmentViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """A course directly assigned to one specific user — see
    CourseAssignment's own docstring for why this deliberately has NO
    "already has it via a Group" conflict check: Groups routinely overlap
    on the same course, and the two assignment mechanisms are meant to
    freely coexist. Read access is broader than write access (IsAuthenticated,
    not IsAdminOrManager) specifically so a member can list their OWN direct
    assignments — frontend/src/lib/role-access.ts's getVisibleCourseIds()
    relies on exactly that to fold direct assignments into a member's
    portal-visible course set.

    Deliberately NOT a plain ModelViewSet — there is no update action here
    (PUT/PATCH), by design, not oversight: course-access-cell.tsx only ever
    creates or deletes a row, and allowing PATCH would let an admin/manager
    silently repoint an existing row's `user` (or `course`) to someone else
    entirely, bypassing perform_create's team check below, which only ever
    runs on the equivalent POST. Excluding UpdateModelMixin removes PUT/PATCH
    from the router altogether (a clean 405) rather than relying on a
    perform_update override to remember to repeat that same check."""

    queryset = CourseAssignment.objects.select_related('course', 'user', 'assigned_by')
    serializer_class = CourseAssignmentSerializer
    permission_classes = [IsAdminOrManagerOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role == User.Role.ADMIN:
            pass
        elif user.role == User.Role.MANAGER:
            qs = qs.filter(user__team=user.team)
        else:
            qs = qs.filter(user=user)

        course_id = self.request.query_params.get('course')
        if course_id:
            qs = qs.filter(course_id=course_id)
        target_user_id = self.request.query_params.get('user')
        if target_user_id:
            qs = qs.filter(user_id=target_user_id)
        return qs

    def perform_create(self, serializer):
        # Same reasoning as CourseDeadlineExtensionViewSet.perform_create
        # above — get_queryset's team-scoping only protects existing rows,
        # a manager POSTing for an arbitrary user id needs its own check.
        requester = self.request.user
        target_user = serializer.validated_data['user']
        if requester.role != User.Role.ADMIN and target_user.team != requester.team:
            raise PermissionDenied("Cannot assign a course to a user outside your team.")
        serializer.save(assigned_by=requester)
