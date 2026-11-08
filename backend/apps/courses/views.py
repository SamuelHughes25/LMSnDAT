from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import SAFE_METHODS, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Group, User
from apps.core.permissions import (
    CanManageCourseDeadlines, CanManageCourseGroups, CanManageCourseMembers, CanManageCourseSettings,
    HasArchiveTabAccessOrIsOwner, HasDashboardTabAccess, IsContentOwnerEditorOrAdmin, IsContentOwnerOrAdmin,
    IsSuperuser, user_can_access_tab, user_can_edit_content, user_can_manage_course_admin,
)
from apps.core.utils import parse_int_pk
from . import services
from .grading import SCORABLE_SLIDE_TYPES, slide_is_configured
from .models import (
    Course, CourseAccessGrant, CourseAsset, CourseAssignment, CourseAttempt, CourseContentRole,
    CourseDeadlineExtension, CourseVersion, Lesson, ReusableLesson, Slide, SlideResult, SlideTemplate,
)
from .serializers import (
    CourseAssetSerializer, CourseAssignmentSerializer, CourseAttemptSerializer, CourseDeadlineExtensionSerializer,
    CourseSerializer, CourseVersionSerializer, LessonSerializer, ReusableLessonDetailSerializer,
    ReusableLessonSerializer, SlideResultBulkUpsertSerializer, SlideResultSerializer, SlideSerializer,
    SlideTemplateSerializer,
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
    ).prefetch_related('editors', 'groups')
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
        if self.action == 'create_draft':
            # Starting a new draft version is builder-content work, same
            # tier as actually editing lessons/slides — editor status
            # alone is enough, no can_edit_course_settings needed (unlike
            # update/partial_update just below, which is the Settings
            # tab's own save action).
            return [IsContentOwnerEditorOrAdmin()]
        if self.action in ('update', 'partial_update'):
            return [CanManageCourseSettings()]
        if self.action == 'transfer_ownership':
            # Super-super-user only now — not the owner, not even someone
            # with the Courses tab. See IsSuperuser's own comment for why.
            return [IsSuperuser()]
        if self.action in ('set_editors', 'set_groups'):
            return [CanManageCourseMembers() if self.action == 'set_editors' else CanManageCourseGroups()]
        if self.action in ('claim_edit', 'release_edit'):
            # Same tier as actually editing the course — claiming the lock
            # is meaningless for someone who couldn't open the builder in
            # the first place.
            return [IsContentOwnerEditorOrAdmin()]
        if self.action == 'deadlines':
            # Courses tab access, not owner/editor — same tier as the
            # Analytics page itself, which is the only caller.
            return [HasDashboardTabAccess()]
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
        # permanent authorship history. See transfer_ownership below. No
        # CourseContentRole write needed here — the purge check (see
        # purge() below) always also checks the CURRENT owner live, so the
        # very first owner is already covered without a history row from
        # day one; a row only becomes necessary once they stop being the
        # current owner, which transfer_ownership itself writes.
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
        # Recorded BEFORE reassigning — once `course.owner` is overwritten
        # below, the outgoing owner has no other record of ever having held
        # the role (see CourseContentRole's own docstring for why that
        # matters at purge time). get_or_create, not create: transferring
        # ownership back and forth between the same two people must never
        # violate the (course, user) uniqueness constraint.
        CourseContentRole.objects.get_or_create(course=course, user=course.owner)
        course.owner = new_owner
        course.save(update_fields=['owner'])
        CourseContentRole.objects.get_or_create(course=course, user=new_owner)
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
        target_editors = User.objects.filter(pk__in=parsed_ids)
        # Recorded before the replace below, covering both whoever is an
        # editor right now (about to possibly be removed) and whoever is
        # about to become one — append-only history, see
        # CourseContentRole's own docstring. ignore_conflicts rather than N
        # individual get_or_create calls: cheaper, and ignoring a duplicate
        # (course, user) pair is exactly the desired behavior here anyway.
        CourseContentRole.objects.bulk_create(
            [CourseContentRole(course=course, user=u) for u in [*course.editors.all(), *target_editors]],
            ignore_conflicts=True,
        )
        # Full replace, same "send the complete list" convention as
        # Group.courses/templates and User.content_groups elsewhere in
        # this app — not an incremental add/remove.
        course.editors.set(target_editors)
        return Response(CourseSerializer(course, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='set-groups')
    def set_groups(self, request, pk=None):
        # The Groups tab's own save action, from the course's side —
        # deliberately NOT a PATCH to /groups/{id}/ (that still requires
        # the full 'groups' tab, unchanged) so an owner/editor-with-
        # can_edit_course_groups can toggle which groups bundle THIS
        # course without needing broader group-management access. `groups`
        # is the reverse accessor for Group.courses (related_name
        # ='groups'), so .set() here mutates the exact same M2M a plain
        # GroupViewSet PATCH would, just from the other side of it.
        course = self.get_object()
        group_ids = request.data.get('groups', [])
        if not isinstance(group_ids, list):
            return Response({'groups': 'Must be a list of group ids.'}, status=400)
        matched = Group.objects.filter(pk__in=group_ids)
        if len(matched) != len(set(group_ids)):
            return Response({'groups': 'Must be a list of valid group ids.'}, status=400)
        course.groups.set(matched)
        return Response(CourseSerializer(course, context={'request': request}).data)

    @action(detail=True, methods=['get'])
    def deadlines(self, request, pk=None):
        # Each user's own effective due date, keyed by user id — the
        # Analytics page's Deadline column needs this for every user with
        # history on the course, but can no longer compute it itself the
        # way it used to (a single shared Course.deadline plus a per-user
        # extension): the base due date is now per-user, anchored to
        # WHEN THEY became eligible for the course at all (see
        # CourseAccessGrant's own docstring and Course.effective_deadline_for),
        # which only this server ever has the data to compute. Scoped to
        # users with a real CourseAccessGrant — anyone who's ever actually
        # had access to the course, which covers everyone who could
        # possibly show up in its attempt history.
        course = self.get_object()
        grants = CourseAccessGrant.objects.filter(course=course).select_related('user')
        return Response({str(g.user_id): course.effective_deadline_for(g.user) for g in grants})

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
        # Attempts from the course's own content team (its current owner,
        # any current editor, or anyone who has EVER held either role — see
        # CourseContentRole's own docstring) are just that team testing
        # their own work, and get wiped along with everything else below.
        # A course with an attempt from anyone outside that set has real
        # learner history riding on it, which purge must refuse to destroy
        # — archiving is as far as that course can go; a content creator
        # unhappy with their own draft/test run is exactly the case this
        # whole feature exists to let through instead.
        friendly_user_ids = set(course.content_role_history.values_list('user_id', flat=True))
        friendly_user_ids.add(course.owner_id)
        friendly_user_ids.update(course.editors.values_list('id', flat=True))
        has_unfriendly_attempt = (
            CourseAttempt.objects.filter(course_version__course=course).exclude(user_id__in=friendly_user_ids).exists()
        )
        if has_unfriendly_attempt:
            return Response(
                {
                    'detail': (
                        "This course can't be permanently deleted — someone other than its own owner or an "
                        "editor has already attempted it. Archive is as far as it can go."
                    ),
                },
                status=400,
            )
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
        try:
            published = services.publish_version(version, request.user)
        except ValueError as e:
            # Same "plain ValueError -> a clean {detail: ...} 400" pattern
            # as revert's own try/except just below — publish_version can
            # now also refuse an empty-of-slides draft (see its own
            # comment), and without this that raised ValueError the same
            # way the "already a draft" case always has: as an unhandled
            # 500, not a message the frontend's extractErrorDetail
            # convention could show.
            raise ValidationError({'detail': str(e)})
        return Response(CourseVersionSerializer(published).data)

    @action(detail=True, methods=['post'])
    def revert(self, request, pk=None):
        version = self.get_object()
        try:
            new_draft = services.revert_to_version(version, request.user)
        except ValueError as e:
            # services.revert_to_version's own "a draft already exists"
            # guard raises plain ValueError — turned into a real 400 here
            # (not DRF's default 500-on-unhandled-exception) so the
            # frontend's existing extractErrorDetail convention picks up
            # a clean {detail: "..."} message instead of a stack trace.
            raise ValidationError({'detail': str(e)})
        return Response(CourseVersionSerializer(new_draft).data, status=201)


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

    queryset = ReusableLesson.objects.all().prefetch_related('slides')
    serializer_class = ReusableLessonSerializer
    required_tab = 'courses'

    def get_permissions(self):
        if self.action == 'import_into':
            return [IsAuthenticated()]
        return [HasDashboardTabAccess()]

    # The "Preview" button in the manage-lessons dialog needs this entry's
    # real slides (to hand to CoursePreviewViewer) — the list endpoint's own
    # serializer deliberately only ever returns a slide_count (see its own
    # comment), so retrieve alone switches to the detail shape.
    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ReusableLessonDetailSerializer
        return super().get_serializer_class()

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

    @action(detail=True, methods=['post'], url_path='save-as-template')
    def save_as_template(self, request, pk=None):
        slide = self.get_object()
        name = request.data.get('name') or slide.title
        slide_template = services.save_slide_as_template(slide, name, request.user)
        return Response(SlideTemplateSerializer(slide_template).data, status=201)


class SlideTemplateViewSet(viewsets.ModelViewSet):
    """The saved-slide library — see SlideTemplate's own docstring. Entries
    are only ever created via SlideViewSet.save_as_template above (cloning
    an existing authored slide's config), never directly through this
    viewset's own create, so this intentionally has no custom
    perform_create; standard list/retrieve/destroy cover the Add slide
    menu's needs. Same admin-only-library-but-editor-can-use-it split as
    ReusableLessonViewSet above, for the identical reason: the library
    itself has no single owning course to check edit access against, but
    `import_into`'s real effect is adding a slide to a SPECIFIC lesson, so
    it checks edit access against that lesson's course manually instead.
    """

    queryset = SlideTemplate.objects.all()
    serializer_class = SlideTemplateSerializer
    required_tab = 'courses'

    def get_permissions(self):
        if self.action == 'import_into':
            return [IsAuthenticated()]
        return [HasDashboardTabAccess()]

    @action(detail=True, methods=['post'], url_path='import')
    def import_into(self, request, pk=None):
        slide_template = self.get_object()
        lesson_id = request.data.get('lesson')
        lesson = Lesson.objects.filter(id=lesson_id).first()
        if not lesson:
            return Response({'lesson': 'Required and must reference an existing lesson.'}, status=400)
        if not user_can_edit_content(request.user, lesson.course_version.course, self.required_tab):
            raise PermissionDenied("You don't have edit access to this course.")
        if lesson.course_version.status != CourseVersion.Status.DRAFT:
            return Response({'lesson': 'Can only import into a draft course version.'}, status=400)
        order = request.data.get('order', 0)
        new_slide = services.import_slide_template(slide_template, lesson, order)
        return Response(SlideSerializer(new_slide).data, status=201)


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
    queryset = CourseAttempt.objects.select_related(
        'course_version__course', 'user', 'user__permission_set',
    ).prefetch_related('slide_results')
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
        # The actual enforcement boundary — nothing before this point ever
        # checked whether `user` was supposed to have this course at all.
        # /courses/ itself is deliberately open-read to everyone (see
        # CourseViewSet.get_permissions' own comment — the portal reads it
        # directly), and the frontend's own role-access.ts filtering is
        # cosmetic UI only, so without this check any authenticated user
        # could POST any course_version id straight to this endpoint and
        # start (and finish) a course nobody ever assigned them — confirmed
        # directly as a real gap, not hypothetical. See Course.is_accessible_by's
        # own docstring for exactly who qualifies.
        if not course_version.course.is_accessible_by(user):
            raise PermissionDenied("You don't have access to this course.")
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
        # Every SCORABLE slide in the course counts toward the score,
        # whether or not the learner actually submitted a result for it —
        # a skipped question is a wrong one, not an excluded one. Averaging
        # only over SUBMITTED SlideResult rows (the old behavior) silently
        # dropped unanswered questions from the denominator entirely,
        # either inflating the score or, if nothing was ever answered,
        # leaving it None even though the course plainly has assessment
        # slides. None is reserved for the one case it should mean: this
        # course genuinely has no scorable slides at all.
        #
        # SCORABLE_SLIDE_TYPES (not GRADABLE_SLIDE_TYPES) is deliberate —
        # accordion/flashcards/hotspot_image are gradable in the sense that
        # grade_slide() runs on them, but they're pure completion gates with
        # no reachable wrong answer (see grading.py's own comment), so they
        # never belong in a score/pass-fail calculation at all.
        #
        # Filtered again through slide_is_configured — SCORABLE_SLIDE_TYPES
        # membership is a property of the slide's TYPE, not of whether this
        # particular slide was ever actually finished being authored (e.g.
        # a missing_word slide with no blanks defined, or a multiple_choice
        # one with a blank question) — see that function's own comment.
        # Reported directly: an unfinished placeholder slide left in a
        # published course permanently cost a learner a point for a
        # question they were never actually capable of answering, right or
        # wrong, just because its slide_type happened to be scorable.
        configured_slide_ids = [
            s.id for s in Slide.objects.filter(
                lesson__course_version_id=attempt.course_version_id,
                slide_type__in=SCORABLE_SLIDE_TYPES,
            )
            if slide_is_configured(s)
        ]
        gradable_slide_count = len(configured_slide_ids)
        # Each scorable slide is worth exactly one point, all or nothing —
        # is_correct (not the partial-credit `score` float grade_slide()
        # also returns for a multi-part slide like missing_word/sequencing/
        # match_pairs) is what's counted here. Averaging the float instead
        # used to let e.g. a match_pairs slide with 1 of 4 pairs right
        # contribute 0.25 of a point to the total, producing results like
        # "56%" for what the learner experienced as 2 right answers and 1
        # wrong one out of a small number of questions — technically
        # defensible as finer-grained credit, but it doesn't match how
        # anyone actually reasons about a right/wrong quiz score, and was
        # reported as exactly that: confusing, unexplainable arithmetic.
        correct_count = attempt.slide_results.filter(
            slide_id__in=configured_slide_ids, is_correct=True,
        ).count()
        score = round(correct_count / gradable_slide_count * 100) if gradable_slide_count else None

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
    # CanManageCourseDeadlines, not plain HasDashboardTabAccess — editing
    # someone's own due date now needs owner status, or editor status plus
    # the dedicated can_edit_course_deadlines sub-permission (see that
    # class's own docstring for why this is split out from
    # can_edit_course_members). Reading stays open to anyone with Courses
    # tab access via its own SAFE_METHODS branch.
    permission_classes = [CanManageCourseDeadlines]
    required_tab = 'courses'

    def get_queryset(self):
        qs = super().get_queryset()
        # No team-scoping any more — see CourseAttemptViewSet.get_queryset's
        # identical comment. Anyone reaching this endpoint for reading at
        # all already has Courses tab access (CanManageCourseDeadlines'
        # own SAFE_METHODS branch), so there's no narrower-but-still-allowed
        # case left to scope down to.
        course_id = self.request.query_params.get('course')
        if course_id:
            qs = qs.filter(course_id=course_id)
        target_user_id = self.request.query_params.get('user')
        if target_user_id:
            qs = qs.filter(user_id=target_user_id)
        return qs

    def perform_create(self, serializer):
        # No object exists yet for CanManageCourseDeadlines' object-level
        # check to run against — re-check here, same safety-net pattern
        # CanManageCourseMembers' own docstring describes for every create
        # action in this app.
        course = serializer.validated_data['course']
        if not user_can_manage_course_admin(self.request.user, course, 'can_edit_course_deadlines'):
            raise PermissionDenied("You don't have permission to edit deadlines on this course.")
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
        # create/destroy now need the SAME "owner, or editor with
        # can_edit_course_members" tier as CourseViewSet.set_editors — see
        # CanManageCourseMembers' own docstring. Its has_permission lets
        # create through at the class level (no object exists yet);
        # perform_create below re-checks it against the resolved course,
        # same pattern IsContentOwnerEditorOrAdmin's docstring describes
        # for every create action in this app. destroy goes through the
        # normal get_object() -> check_object_permissions path, which
        # fires has_object_permission correctly on its own.
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [CanManageCourseMembers()]

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
        course = serializer.validated_data.get('course')
        if not user_can_manage_course_admin(self.request.user, course, 'can_edit_course_members'):
            raise PermissionDenied("You don't have permission to manage this course's members.")
        # Refuse a direct assignment that would be a redundant no-op — the
        # target already reaches this course some other way (owner,
        # editor, or a Group that has it), so adding a direct assignment
        # on top wouldn't change what they can actually see/do at all,
        # just leave a confusing extra row behind. See
        # Course.existing_access_reason's own docstring for exactly which
        # paths this covers (deliberately NOT an existing direct
        # assignment itself — that's the DB's own UniqueConstraint's job).
        target_user = serializer.validated_data.get('user')
        reason = course.existing_access_reason(target_user)
        if reason:
            raise ValidationError({'detail': f"Can't directly assign this course — {reason}"})
        serializer.save(assigned_by=self.request.user)
