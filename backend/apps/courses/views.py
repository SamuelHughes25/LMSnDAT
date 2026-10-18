from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import SAFE_METHODS, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.core.permissions import (
    HasArchiveTabAccessOrIsOwner, HasDashboardTabAccess, IsContentOwnerEditorOrAdmin, IsContentOwnerOrAdmin, IsSuperuser,
    user_can_access_tab, user_can_edit_content,
)
from apps.core.utils import parse_int_pk
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
    # owner/created_by/archived_by select_related alongside editing_user —
    # CourseSerializer's owner_username/created_by_username/
    # archived_by_username (ReadOnlyField(source='<fk>.username')) each
    # trigger one query PER ROW without this: confirmed via
    # CaptureQueriesContext that listing 10 courses took 22 queries (1 list
    # + 1 editors prefetch + 2 per row for owner/created_by) instead of the
    # 2 this produces — the N+1 that made the course list (and the portal,
    # which hits this same endpoint) visibly slower as the catalog grew.
    queryset = Course.objects.all().select_related(
        'editing_user', 'owner', 'created_by', 'archived_by',
    ).prefetch_related('editors')
    serializer_class = CourseSerializer
    required_tab = 'courses'

    def get_owning_content(self, obj):
        # obj IS the content here — see IsContentOwnerEditorOrAdmin's own
        # docstring for why every viewset needs this method.
        return obj

    def get_permissions(self):
        # Editing this course's own fields (and create-draft, which starts
        # a new version of it) opens up to the owner/editors, not just
        # someone with the Courses tab — everything else (create a
        # brand-new course) is tab-gated as normal. Archive/restore/purge
        # are their own, separate 'archive' tab, not 'courses'. Managing
        # WHO owns/edits this course is its own, stricter tier. Reading
        # (list/retrieve) stays open to any authenticated user regardless
        # of tab access — unlike every other dashboard-only resource, the
        # PORTAL (member-facing, no permission set at all) also reads
        # course data directly, same as the old IsAdminOrReadOnly's open-
        # read behavior this replaced.
        if self.action in ('update', 'partial_update', 'create_draft'):
            return [IsContentOwnerEditorOrAdmin()]
        if self.action == 'transfer_ownership':
            # Super-super-user only now — not the owner, not even someone
            # with the Courses tab. See IsSuperuser's own comment for why.
            return [IsSuperuser()]
        if self.action == 'set_editors':
            return [IsContentOwnerOrAdmin()]
        if self.action in ('claim_edit', 'release_edit'):
            # Same tier as actually editing the course — claiming the lock
            # is meaningless for someone who couldn't open the builder in
            # the first place.
            return [IsContentOwnerEditorOrAdmin()]
        if self.action in ('destroy', 'restore', 'purge'):
            # Owner can always archive/restore/purge their own course too,
            # even with no Archive tab granted — see
            # HasArchiveTabAccessOrIsOwner's own comment.
            return [HasArchiveTabAccessOrIsOwner()]
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [HasDashboardTabAccess()]

    def get_queryset(self):
        qs = super().get_queryset()
        # Archived courses are excluded from every normal list by default —
        # this one filter is what makes archiving "remove it from
        # everywhere" (admin list, portal, Groups' course picker, Roles
        # tabs) without needing matching exclusion logic in each of those
        # places individually. ?archived=true is the one deliberate
        # opt-in, used only by the admin Archive page.
        if self.request.query_params.get('archived') == 'true':
            qs = qs.filter(is_archived=True)
        else:
            qs = qs.filter(is_archived=False)
        return qs

    def perform_create(self, serializer):
        # owner starts as the creator too (same user as created_by) — it's
        # just transferable afterward, unlike created_by, which stays
        # permanent authorship history. See transfer_ownership below.
        serializer.save(created_by=self.request.user, owner=self.request.user)

    @action(detail=True, methods=['post'], url_path='transfer-ownership')
    def transfer_ownership(self, request, pk=None):
        # get_permissions gates this to the CURRENT owner or an admin —
        # self.get_object() re-checks that against the course this id
        # actually resolves to (not just whatever course the request
        # claims), via DRF's automatic check_object_permissions.
        course = self.get_object()
        new_owner_id = parse_int_pk(request.data.get('owner'))
        new_owner = User.objects.filter(pk=new_owner_id).first() if new_owner_id is not None else None
        if not new_owner:
            return Response({'owner': 'Required and must reference an existing user.'}, status=400)
        course.owner = new_owner
        course.save(update_fields=['owner'])
        return Response(CourseSerializer(course, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='set-editors')
    def set_editors(self, request, pk=None):
        course = self.get_object()
        editor_ids = request.data.get('editors', [])
        if not isinstance(editor_ids, list):
            return Response({'editors': 'Must be a list of user ids.'}, status=400)
        parsed_ids = [parse_int_pk(v) for v in editor_ids]
        if any(i is None for i in parsed_ids):
            return Response({'editors': 'Must be a list of valid user ids.'}, status=400)
        # Full replace, same "send the complete list" convention as
        # Group.courses/templates and User.content_groups elsewhere in
        # this app — not an incremental add/remove.
        course.editors.set(User.objects.filter(pk__in=parsed_ids))
        return Response(CourseSerializer(course, context={'request': request}).data)

    def destroy(self, request, *args, **kwargs):
        # The trash button now archives instead of hard-deleting — see
        # restore/purge below for the rest of the lifecycle. Mirrors
        # TemplateViewSet.destroy/UserViewSet.destroy exactly.
        course = self.get_object()
        course.is_archived = True
        course.archived_by = request.user
        course.archived_at = timezone.now()
        course.save(update_fields=['is_archived', 'archived_by', 'archived_at'])
        return Response(status=204)

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        # Looked up against the unfiltered model manager, not
        # self.get_object() — get_queryset() excludes archived rows by
        # default, which is exactly what this action needs to find. That
        # means DRF's usual get_object()-triggered check_object_permissions
        # never runs here, so it's called explicitly — otherwise
        # HasArchiveTabAccessOrIsOwner's object-level owner check would
        # silently never fire and this action would be tab-gated only.
        course = get_object_or_404(Course, pk=pk)
        self.check_object_permissions(request, course)
        course.is_archived = False
        course.archived_by = None
        course.archived_at = None
        course.save(update_fields=['is_archived', 'archived_by', 'archived_at'])
        return Response(CourseSerializer(course, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def purge(self, request, pk=None):
        # The real, final hard delete — only reachable from the Archive
        # page against an already-archived course. CourseAttempt.course_version
        # is the one PROTECT standing between a Course and deletion (confirmed:
        # no other model anywhere protects Course/CourseVersion); explicitly
        # deleting those rows first is a deliberate purge of that course's
        # history across every user who took it, then course.delete() cascades
        # the rest (CourseVersion -> Lesson -> Slide -> SlideResult,
        # CourseDeadlineExtension, CourseAssignment) cleanly since those are
        # all plain CASCADE already.
        course = get_object_or_404(Course, pk=pk)
        self.check_object_permissions(request, course)
        if not course.is_archived:
            return Response({'detail': 'Only archived courses can be permanently deleted.'}, status=400)
        with transaction.atomic():
            CourseAttempt.objects.filter(course_version__course=course).delete()
            course.delete()
        return Response(status=204)

    @action(detail=True, methods=['post'], url_path='create-draft')
    def create_draft(self, request, pk=None):
        course = self.get_object()
        version = services.create_draft_version(course, request.user)
        return Response(CourseVersionSerializer(version).data, status=201)

    @action(detail=True, methods=['post'], url_path='claim-edit')
    def claim_edit(self, request, pk=None):
        # A genuine hard lock — no override. An earlier version of this
        # accepted a `force` flag to let a second editor in anyway after a
        # warning; removed outright once it became clear what that
        # actually led to: course-builder.tsx's handleSlideConfigChange
        # PATCHes a slide's ENTIRE config JSON blob on every save, built
        # from whatever that one browser's own (potentially stale) copy
        # currently holds — so two people in the same slide at once doesn't
        # just risk clobbering the one field they both touched, it risks
        # one of them silently erasing the other's unrelated edits
        # elsewhere on the same slide the instant either one saves. A
        # warning the user can click past doesn't prevent that; only
        # actually keeping the second person out does.
        course = self.get_object()
        if course.is_being_edited() and course.editing_user_id != request.user.id:
            return Response(
                {'detail': f'{course.editing_user.username} is currently editing this course.',
                 'editing_by': course.editing_user.username},
                status=409,
            )
        course.editing_user = request.user
        course.editing_heartbeat_at = timezone.now()
        course.save(update_fields=['editing_user', 'editing_heartbeat_at'])
        return Response(CourseSerializer(course, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='release-edit')
    def release_edit(self, request, pk=None):
        # Only clears the lock if it's still this user's own — a late-
        # arriving release call must never clobber whoever holds it now.
        course = self.get_object()
        if course.editing_user_id == request.user.id:
            course.editing_user = None
            course.editing_heartbeat_at = None
            course.save(update_fields=['editing_user', 'editing_heartbeat_at'])
        return Response(status=204)


class CourseVersionViewSet(viewsets.ModelViewSet):
    # created_by alongside course — same N+1 reasoning as CourseViewSet
    # above: CourseVersionSerializer.created_by_username reads
    # created_by.username per row.
    queryset = CourseVersion.objects.select_related('course', 'created_by').prefetch_related(
        'lessons__slides', 'assets',
    )
    serializer_class = CourseVersionSerializer
    permission_classes = [IsContentOwnerEditorOrAdmin]
    required_tab = 'courses'

    def get_owning_content(self, obj):
        return obj.course

    def get_queryset(self):
        qs = super().get_queryset()
        course_id = self.request.query_params.get('course')
        if course_id:
            qs = qs.filter(course_id=course_id)
        return qs

    def perform_create(self, serializer):
        # has_object_permission (IsContentOwnerEditorOrAdmin) only fires
        # once an instance exists — create needs its own check, resolving
        # the ancestor Course from the submitted data instead. Mirrors
        # CourseAssignmentViewSet.perform_create's existing manual check.
        course = serializer.validated_data['course']
        if not user_can_edit_content(self.request.user, course, self.required_tab):
            raise PermissionDenied("You don't have edit access to this course.")
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        version = self.get_object()
        published = services.publish_version(version, request.user)
        return Response(CourseVersionSerializer(published).data)


class LessonViewSet(viewsets.ModelViewSet):
    queryset = Lesson.objects.all()
    serializer_class = LessonSerializer
    permission_classes = [IsContentOwnerEditorOrAdmin]
    required_tab = 'courses'

    def get_owning_content(self, obj):
        return obj.course_version.course

    def get_queryset(self):
        qs = super().get_queryset()
        version_id = self.request.query_params.get('course_version')
        if version_id:
            qs = qs.filter(course_version_id=version_id)
        return qs

    def perform_create(self, serializer):
        course = serializer.validated_data['course_version'].course
        if not user_can_edit_content(self.request.user, course, self.required_tab):
            raise PermissionDenied("You don't have edit access to this course.")
        serializer.save()

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
    list/retrieve/destroy cover the manage/import dialog's needs.

    The library itself (create/update/destroy a saved entry) stays admin-
    only — it has no single owning course for IsContentOwnerEditorOrAdmin
    to check against (see ReusableLesson's own docstring: a fully
    independent, standing library item). `import_into` is the one
    exception: its real effect is adding a lesson to a SPECIFIC course's
    draft, so it checks edit access against that TARGET course manually
    instead, same reasoning as CourseAssignmentViewSet.perform_create's
    existing manual check — an editor should be able to use the library on
    their own course even though they can't manage the library itself.
    """

    queryset = ReusableLesson.objects.all()
    serializer_class = ReusableLessonSerializer
    required_tab = 'courses'

    def get_permissions(self):
        if self.action == 'import_into':
            return [IsAuthenticated()]
        return [HasDashboardTabAccess()]

    @action(detail=True, methods=['post'], url_path='import')
    def import_into(self, request, pk=None):
        reusable_lesson = self.get_object()
        version_id = request.data.get('course_version')
        target_version = CourseVersion.objects.filter(id=version_id).first()
        if not target_version:
            return Response({'course_version': 'Required and must reference an existing course version.'}, status=400)
        if not user_can_edit_content(request.user, target_version.course, self.required_tab):
            raise PermissionDenied("You don't have edit access to this course.")
        if target_version.status != CourseVersion.Status.DRAFT:
            return Response({'course_version': 'Can only import into a draft course version.'}, status=400)
        order = request.data.get('order', 0)
        new_lesson = services.import_reusable_lesson(reusable_lesson, target_version, order)
        return Response(LessonSerializer(new_lesson).data, status=201)


class SlideViewSet(viewsets.ModelViewSet):
    queryset = Slide.objects.all()
    serializer_class = SlideSerializer
    permission_classes = [IsContentOwnerEditorOrAdmin]
    required_tab = 'courses'

    def get_owning_content(self, obj):
        return obj.lesson.course_version.course

    def get_queryset(self):
        qs = super().get_queryset()
        lesson_id = self.request.query_params.get('lesson')
        if lesson_id:
            qs = qs.filter(lesson_id=lesson_id)
        return qs

    def perform_create(self, serializer):
        course = serializer.validated_data['lesson'].course_version.course
        if not user_can_edit_content(self.request.user, course, self.required_tab):
            raise PermissionDenied("You don't have edit access to this course.")
        serializer.save()


class CourseAssetViewSet(viewsets.ModelViewSet):
    queryset = CourseAsset.objects.all()
    serializer_class = CourseAssetSerializer
    permission_classes = [IsContentOwnerEditorOrAdmin]
    required_tab = 'courses'

    def get_owning_content(self, obj):
        return obj.course_version.course

    def get_queryset(self):
        qs = super().get_queryset()
        version_id = self.request.query_params.get('course_version')
        if version_id:
            qs = qs.filter(course_version_id=version_id)
        return qs

    def perform_create(self, serializer):
        course = serializer.validated_data['course_version'].course
        if not user_can_edit_content(self.request.user, course, self.required_tab):
            raise PermissionDenied("You don't have edit access to this course.")
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
        # Full visibility for anyone with Courses tab access (or above) —
        # no team-scoping any more (that was role=='manager'-specific;
        # permission sets are flat/global, see apps.core.permissions
        # .user_can_access_tab's own comment on this deliberate change).
        # Anyone else only ever sees their own attempts.
        if not user_can_access_tab(user, 'courses'):
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
        results = serializer.validated_data['results']

        # Every submitted `slide` id must actually belong to THIS attempt's
        # own course_version — grade_slide() (via SlideResult.save()) is
        # already tamper-proof against a forged is_correct/score for a
        # given slide, but without this check nothing stopped a learner
        # from submitting a result for an entirely DIFFERENT course's
        # trivially-easy slide (e.g. a flashcards slide, graded correct the
        # instant its cards are marked "viewed", no right/wrong answer to
        # even get wrong). complete() averages every SlideResult row on the
        # attempt with no awareness of which course each slide belongs to,
        # so that extra row would have silently inflated THIS course's
        # score — a real, confirmed false-pass exploit on exactly the kind
        # of legally-binding compliance training grading.py's own module
        # docstring exists to protect. One query up front (not a get() per
        # item in the loop below) keeps this a single extra round trip
        # regardless of how many results are in the batch.
        slide_ids = {item['slide'] for item in results}
        valid_slide_ids = set(
            Slide.objects.filter(
                id__in=slide_ids, lesson__course_version_id=attempt.course_version_id,
            ).values_list('id', flat=True)
        )
        invalid_ids = slide_ids - valid_slide_ids
        if invalid_ids:
            raise ValidationError({
                'results': f"Slide(s) {', '.join(str(i) for i in invalid_ids)} are not part of this attempt's course.",
            })

        saved = []
        with transaction.atomic():
            for item in results:
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
    touch this endpoint directly; it's dashboard tooling, surfaced from
    the course's own per-user analytics table."""

    queryset = CourseDeadlineExtension.objects.select_related('course', 'user')
    serializer_class = CourseDeadlineExtensionSerializer
    permission_classes = [HasDashboardTabAccess]
    required_tab = 'courses'

    def get_queryset(self):
        qs = super().get_queryset()
        # No team-scoping any more — see CourseAttemptViewSet.get_queryset's
        # identical comment. Anyone reaching this endpoint at all already
        # has Courses tab access (the class-level permission above), so
        # there's no narrower-but-still-allowed case left to scope down to.
        course_id = self.request.query_params.get('course')
        if course_id:
            qs = qs.filter(course_id=course_id)
        target_user_id = self.request.query_params.get('user')
        if target_user_id:
            qs = qs.filter(user_id=target_user_id)
        return qs


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
    freely coexist. Read access is broader than write access (any
    authenticated user, not gated on the Courses tab) specifically so a
    member can list their OWN direct assignments —
    frontend/src/lib/role-access.ts's getVisibleCourseIds() relies on
    exactly that to fold direct assignments into a member's portal-visible
    course set.

    Deliberately NOT a plain ModelViewSet — there is no update action here
    (PUT/PATCH), by design, not oversight: course-access-cell.tsx only ever
    creates or deletes a row, and allowing PATCH would let someone with
    Courses tab access silently repoint an existing row's `user` (or
    `course`) to someone else entirely. Excluding UpdateModelMixin removes
    PUT/PATCH from the router altogether (a clean 405)."""

    queryset = CourseAssignment.objects.select_related('course', 'user', 'assigned_by')
    serializer_class = CourseAssignmentSerializer
    required_tab = 'courses'

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [HasDashboardTabAccess()]

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        # No team-scoping any more — see CourseAttemptViewSet.get_queryset's
        # identical comment. Full visibility for anyone with Courses tab
        # access; anyone else (a member reading their own direct
        # assignments) only ever sees their own.
        if not user_can_access_tab(user, 'courses'):
            qs = qs.filter(user=user)

        course_id = self.request.query_params.get('course')
        if course_id:
            qs = qs.filter(course_id=course_id)
        target_user_id = self.request.query_params.get('user')
        if target_user_id:
            qs = qs.filter(user_id=target_user_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(assigned_by=self.request.user)
