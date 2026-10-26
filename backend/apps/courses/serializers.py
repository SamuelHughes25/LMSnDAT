from rest_framework import serializers

from apps.core.permissions import user_can_manage_course_admin
from .constants import SlideType
from .models import (
    Course, CourseAsset, CourseAssignment, CourseAttempt, CourseDeadlineExtension, CourseVersion, Lesson,
    ReusableLesson, Slide, SlideResult,
)


class SlideSerializer(serializers.ModelSerializer):
    class Meta:
        model = Slide
        fields = ['id', 'lesson', 'slide_type', 'title', 'order', 'config']
        read_only_fields = ['id']

    def validate(self, attrs):
        lesson = attrs.get('lesson', getattr(self.instance, 'lesson', None))
        if lesson and lesson.course_version.status != CourseVersion.Status.DRAFT:
            raise serializers.ValidationError('Cannot modify slides on a non-draft course version.')

        slide_type = attrs.get('slide_type', getattr(self.instance, 'slide_type', None))
        config = attrs.get('config', getattr(self.instance, 'config', None) or {})

        if slide_type == SlideType.MULTIPLE_CHOICE:
            options = config.get('options')
            if not options or not isinstance(options, list):
                raise serializers.ValidationError(
                    {'config': 'multiple_choice slides require a non-empty "options" list.'}
                )
            if len(options) < 2 or len(options) > 5:
                raise serializers.ValidationError(
                    {'config': 'multiple_choice slides require between 2 and 5 options.'}
                )
            if not any(isinstance(o, dict) and o.get('is_correct') for o in options):
                raise serializers.ValidationError(
                    {'config': 'multiple_choice slides require at least one option with "is_correct": true.'}
                )

        elif slide_type == SlideType.CATEGORIZE:
            buckets = config.get('buckets')
            items = config.get('items')
            if not buckets or not isinstance(buckets, list):
                raise serializers.ValidationError(
                    {'config': 'categorize slides require a non-empty "buckets" list.'}
                )
            if not items or not isinstance(items, list):
                raise serializers.ValidationError(
                    {'config': 'categorize slides require a non-empty "items" list.'}
                )
            bucket_ids = {b.get('id') for b in buckets if isinstance(b, dict)}
            for item in items:
                if not isinstance(item, dict) or item.get('correct_bucket_id') not in bucket_ids:
                    raise serializers.ValidationError(
                        {'config': 'every item must have a "correct_bucket_id" that references an existing bucket.'}
                    )

        elif slide_type == SlideType.MISSING_WORD:
            paragraph = config.get('paragraph')
            blanks = config.get('blanks')
            # paragraph/blanks are allowed to be empty here — a slide is
            # created with both empty and authored progressively (type the
            # paragraph, then mark blanks one at a time), so requiring
            # either to be non-empty on every save would reject the initial
            # creation request before the author ever gets to type
            # anything. Only their *types* and, once blanks exist, their
            # structural validity (offsets in range, no overlaps) are
            # enforced here; "did the author actually finish this slide" is
            # a publish-time concern, not a save-time one — same reasoning
            # already applied to multiple_choice's default-correct-option
            # fix.
            if paragraph is not None and not isinstance(paragraph, str):
                raise serializers.ValidationError({'config': '"paragraph" must be a string.'})
            if blanks is not None and not isinstance(blanks, list):
                raise serializers.ValidationError({'config': '"blanks" must be a list.'})
            paragraph_len = len(paragraph or '')
            ranges = []
            for blank in (blanks or []):
                if not isinstance(blank, dict):
                    raise serializers.ValidationError({'config': 'each blank must be an object.'})
                start = blank.get('start')
                end = blank.get('end')
                if not isinstance(start, int) or not isinstance(end, int) or isinstance(start, bool) or isinstance(end, bool):
                    raise serializers.ValidationError(
                        {'config': 'each blank must have integer "start"/"end" offsets.'}
                    )
                if not (0 <= start < end <= paragraph_len):
                    raise serializers.ValidationError(
                        {'config': 'each blank\'s "start"/"end" must satisfy 0 <= start < end <= len(paragraph).'}
                    )
                for other_start, other_end in ranges:
                    if start < other_end and other_start < end:
                        raise serializers.ValidationError(
                            {'config': 'blanks must not overlap.'}
                        )
                ranges.append((start, end))

        elif slide_type == SlideType.MATCH_PAIRS:
            instructions = config.get('instructions')
            pairs = config.get('pairs')
            # Same leniency reasoning as MISSING_WORD above, and for the same
            # reason: a slide is created with `pairs: []` and authored
            # progressively (add a pair, type the keyword, type the
            # definition, add another...), so hard-enforcing the spec's "min
            # 2 pairs" on every save would reject the initial creation
            # request and every legitimate single-pair intermediate state
            # before the author finishes — exactly the bug class already hit
            # and fixed twice (multiple_choice, then missing_word). This
            # codebase has no separate "submit for real" step distinct from
            # "save" (every PATCH is a real save), so there is no safe point
            # at which to start applying a hard minimum; the "min 2" rule is
            # therefore UI guidance only (see match-pairs-slide-face.tsx),
            # never a save-time rejection. What IS enforced here is
            # structural validity: once a pair exists it must be a
            # well-formed object with string "keyword"/"definition" fields
            # (empty string is fine — that's mid-typing, not malformed; a
            # missing/non-string field is what actually indicates corrupt
            # data), and the list must not exceed the max of 8 (a real
            # product constraint, not an authoring-in-progress concern, so
            # rejecting over-the-cap is safe at any time).
            if instructions is not None and not isinstance(instructions, str):
                raise serializers.ValidationError({'config': '"instructions" must be a string.'})
            if pairs is not None and not isinstance(pairs, list):
                raise serializers.ValidationError({'config': '"pairs" must be a list.'})
            if pairs:
                if len(pairs) > 8:
                    raise serializers.ValidationError(
                        {'config': 'match_pairs slides allow at most 8 pairs.'}
                    )
                for pair in pairs:
                    if not isinstance(pair, dict):
                        raise serializers.ValidationError({'config': 'each pair must be an object.'})
                    keyword = pair.get('keyword')
                    definition = pair.get('definition')
                    if not isinstance(keyword, str) or not isinstance(definition, str):
                        raise serializers.ValidationError(
                            {'config': 'each pair must have "keyword" and "definition" strings.'}
                        )

        elif slide_type == SlideType.ACCORDION:
            # Same lenient/progressive-authoring reasoning as MATCH_PAIRS
            # above: sections are added and typed into one at a time, so
            # only structural validity and the hard cap are enforced here,
            # never a minimum section count.
            sections = config.get('sections')
            if sections is not None and not isinstance(sections, list):
                raise serializers.ValidationError({'config': '"sections" must be a list.'})
            if sections:
                if len(sections) > 8:
                    raise serializers.ValidationError(
                        {'config': 'accordion slides allow at most 8 sections.'}
                    )
                for section in sections:
                    if not isinstance(section, dict):
                        raise serializers.ValidationError({'config': 'each section must be an object.'})
                    title = section.get('title')
                    body = section.get('body')
                    if not isinstance(title, str) or not isinstance(body, str):
                        raise serializers.ValidationError(
                            {'config': 'each section must have "title" and "body" strings.'}
                        )

        elif slide_type == SlideType.FLASHCARDS:
            # Same lenient/progressive-authoring reasoning as MATCH_PAIRS.
            cards = config.get('cards')
            if cards is not None and not isinstance(cards, list):
                raise serializers.ValidationError({'config': '"cards" must be a list.'})
            if cards:
                if len(cards) > 20:
                    raise serializers.ValidationError(
                        {'config': 'flashcards slides allow at most 20 cards.'}
                    )
                for card in cards:
                    if not isinstance(card, dict):
                        raise serializers.ValidationError({'config': 'each card must be an object.'})
                    front = card.get('front')
                    back = card.get('back')
                    if not isinstance(front, str) or not isinstance(back, str):
                        raise serializers.ValidationError(
                            {'config': 'each card must have "front" and "back" strings.'}
                        )

        elif slide_type == SlideType.SEQUENCING:
            # Same lenient/progressive-authoring reasoning as MATCH_PAIRS.
            # The array's authored order IS the correct order — there is no
            # separate "correct index" field to validate.
            instructions = config.get('instructions')
            items = config.get('sequence_items')
            if instructions is not None and not isinstance(instructions, str):
                raise serializers.ValidationError({'config': '"instructions" must be a string.'})
            if items is not None and not isinstance(items, list):
                raise serializers.ValidationError({'config': '"sequence_items" must be a list.'})
            if items:
                if len(items) > 10:
                    raise serializers.ValidationError(
                        {'config': 'sequencing slides allow at most 10 items.'}
                    )
                for item in items:
                    if not isinstance(item, dict):
                        raise serializers.ValidationError({'config': 'each item must be an object.'})
                    if not isinstance(item.get('text'), str):
                        raise serializers.ValidationError(
                            {'config': 'each item must have a "text" string.'}
                        )

        elif slide_type == SlideType.HOTSPOT_IMAGE:
            # Same lenient/progressive-authoring reasoning as MATCH_PAIRS —
            # a hotspot can exist "placed but not yet labeled" mid-authoring,
            # so an empty "label" is valid, not rejected.
            image_url = config.get('hotspot_image_url')
            hotspots = config.get('hotspots')
            if image_url is not None and not isinstance(image_url, str):
                raise serializers.ValidationError({'config': '"hotspot_image_url" must be a string or null.'})
            if hotspots is not None and not isinstance(hotspots, list):
                raise serializers.ValidationError({'config': '"hotspots" must be a list.'})
            if hotspots:
                if len(hotspots) > 10:
                    raise serializers.ValidationError(
                        {'config': 'hotspot_image slides allow at most 10 hotspots.'}
                    )
                for hotspot in hotspots:
                    if not isinstance(hotspot, dict):
                        raise serializers.ValidationError({'config': 'each hotspot must be an object.'})
                    x_pct = hotspot.get('xPct')
                    y_pct = hotspot.get('yPct')
                    if (
                        not isinstance(x_pct, (int, float)) or isinstance(x_pct, bool)
                        or not isinstance(y_pct, (int, float)) or isinstance(y_pct, bool)
                        or not (0 <= x_pct <= 100) or not (0 <= y_pct <= 100)
                    ):
                        raise serializers.ValidationError(
                            {'config': 'each hotspot must have numeric "xPct"/"yPct" between 0 and 100.'}
                        )
                    if not isinstance(hotspot.get('label'), str):
                        raise serializers.ValidationError(
                            {'config': 'each hotspot must have a "label" string.'}
                        )

        # Cross-cutting, not slide_type-gated — same as background_image_url
        # and its *_pct siblings (see course-types.ts's own comment on why
        # this is a separate field rather than folding background_image_url
        # into it as "item 0"), so this validates unconditionally rather
        # than inside the if/elif chain above. Every other list-of-objects
        # config in this method (accordion's sections, hotspot's hotspots,
        # etc.) gets structural validation even under the same lenient
        # progressive-authoring rules, so this follows suit rather than
        # leaving a brand-new list field completely unchecked.
        extra_images = config.get('extra_images')
        if extra_images is not None and not isinstance(extra_images, list):
            raise serializers.ValidationError({'config': '"extra_images" must be a list.'})
        if extra_images:
            if len(extra_images) > 8:
                raise serializers.ValidationError(
                    {'config': 'a slide allows at most 8 extra images.'}
                )
            for image in extra_images:
                if not isinstance(image, dict):
                    raise serializers.ValidationError({'config': 'each extra image must be an object.'})
                if not isinstance(image.get('id'), str) or not image.get('id'):
                    raise serializers.ValidationError(
                        {'config': 'each extra image must have a non-empty "id" string.'}
                    )
                if not isinstance(image.get('url'), str) or not image.get('url'):
                    raise serializers.ValidationError(
                        {'config': 'each extra image must have a non-empty "url" string.'}
                    )
                for field in ('xPct', 'yPct', 'widthPct', 'heightPct'):
                    value = image.get(field)
                    if not isinstance(value, (int, float)) or isinstance(value, bool):
                        raise serializers.ValidationError(
                            {'config': f'each extra image must have a numeric "{field}".'}
                        )

        return attrs


class LessonSerializer(serializers.ModelSerializer):
    slides = SlideSerializer(many=True, read_only=True)

    class Meta:
        model = Lesson
        fields = ['id', 'course_version', 'title', 'description', 'order', 'slides']
        read_only_fields = ['id']

    def validate(self, attrs):
        version = attrs.get('course_version', getattr(self.instance, 'course_version', None))
        if version and version.status != CourseVersion.Status.DRAFT:
            raise serializers.ValidationError('Cannot modify lessons on a non-draft course version.')
        return attrs


class ReusableLessonSerializer(serializers.ModelSerializer):
    # A count, not the nested slides themselves — the manage/import dialog
    # only needs to show "12 slides" per entry in a list; the full slide
    # configs (potentially large — rich text, image URLs, per-type payloads)
    # would bloat that list response for no UI benefit. The actual slides
    # only ever move server-side, via services.import_reusable_lesson.
    slide_count = serializers.SerializerMethodField()

    class Meta:
        model = ReusableLesson
        fields = ['id', 'name', 'description', 'created_by', 'created_at', 'updated_at', 'slide_count']
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']

    def get_slide_count(self, obj):
        return obj.slides.count()


class CourseAssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseAsset
        fields = ['id', 'course_version', 'file', 'kind', 'uploaded_by', 'created_at']
        read_only_fields = ['id', 'uploaded_by', 'created_at']


class CourseVersionSerializer(serializers.ModelSerializer):
    lessons = LessonSerializer(many=True, read_only=True)
    assets = CourseAssetSerializer(many=True, read_only=True)
    # Convenience field for the Activity tab's version-history table — same
    # ReadOnlyField-username convention as CourseAssignmentSerializer above,
    # so the frontend doesn't need a separate /users/ round-trip just to show
    # who created/published each version.
    created_by_username = serializers.ReadOnlyField(source='created_by.username')

    class Meta:
        model = CourseVersion
        fields = [
            'id', 'course', 'version_number', 'status', 'transition_style', 'created_by',
            'created_by_username', 'published_at', 'created_at', 'updated_at', 'lessons', 'assets',
        ]
        read_only_fields = [
            'id', 'version_number', 'status', 'created_by', 'published_at', 'created_at', 'updated_at',
        ]

    def validate(self, attrs):
        if (
            'transition_style' in attrs
            and self.instance
            and self.instance.status != CourseVersion.Status.DRAFT
        ):
            raise serializers.ValidationError(
                {'transition_style': 'Cannot modify transition_style on a non-draft course version.'}
            )
        return attrs


class CourseSerializer(serializers.ModelSerializer):
    # The REQUESTING user's own effective deadline for this course (their
    # own CourseDeadlineExtension if they have one, else the course's own
    # default `deadline` — see Course.effective_deadline_for()). Computed
    # here, on every course fetch, specifically so the portal (member) side
    # can show "your deadline is X" / flag overdue courses WITHOUT needing
    # access to /course-deadline-extensions/, which is admin/manager-only —
    # a member reading their own effective deadline this way never touches
    # that endpoint at all. None for an unauthenticated request or a course
    # with no deadline.
    my_deadline = serializers.SerializerMethodField()
    archived_by_username = serializers.ReadOnlyField(source='archived_by.username')
    owner_username = serializers.ReadOnlyField(source='owner.username')
    # The permanent record of who originally owned this course — see
    # `owner`'s own transfer-ownership behavior and Course.created_by's
    # own comment on the model for why these two fields answer genuinely
    # different questions now that ownership is transferable:
    # created_by never changes once set (not even transfer_ownership
    # touches it), so this is the one durable "who made this" fact a
    # chain of transfers can never erase — exposed here specifically so
    # the frontend's Ownership card can show it. None if that account was
    # later permanently deleted (created_by is on_delete=SET_NULL) — a
    # plain ReadOnlyField on a null relation just resolves to None, no
    # special-casing needed here.
    created_by_username = serializers.ReadOnlyField(source='created_by.username')
    # len(...all()) not .count() — same reasoning as GroupSerializer's own
    # member_count: CourseViewSet.queryset already does
    # .prefetch_related('editors'), so this reuses that cache instead of a
    # fresh COUNT/SELECT per course.
    editor_usernames = serializers.SerializerMethodField()
    # Null whenever the lock is free OR stale — obj.is_being_edited()
    # (Course's own model method) is the one place that interprets
    # editing_heartbeat_at against EDIT_LOCK_STALE_SECONDS, so the frontend
    # never has to do that staleness math itself or risk it drifting out
    # of sync with the backend's own definition of "still being edited."
    # A plain username string (not editing_user's raw id) since the only
    # use is display — the courses list greying out a card and showing
    # "Being edited by X" (see CourseViewSet.claim_edit/release_edit for
    # how this actually gets set/cleared).
    currently_editing_by = serializers.SerializerMethodField()
    # Which Groups currently bundle this course — the reverse side of
    # Group.courses (related_name='groups'), exposed here so the Groups
    # tab (roles/page.tsx) can show current membership from the course's
    # own side without a second round-trip, and so set_groups's caller
    # knows the current full list before computing a toggle's next state.
    group_ids = serializers.SerializerMethodField()
    # Whether the REQUESTING user can save changes on this course's
    # Members/Groups/Settings tabs respectively — computed here via
    # user_can_manage_course_admin so the frontend never has to re-derive
    # owner/editor/sub-permission logic itself (same "precompute it
    # server-side" convention as UserSerializer.accessible_tabs). All
    # three are independent: an editor might have one sub-permission but
    # not another, or none at all (view-only, per the user's own "allows
    # you to click in and view all the settings... however you shouldn't
    # be able to edit" framing).
    viewer_can_edit_members = serializers.SerializerMethodField()
    viewer_can_edit_groups = serializers.SerializerMethodField()
    viewer_can_edit_settings = serializers.SerializerMethodField()

    class Meta:
        model = Course
        fields = [
            'id', 'name', 'description', 'thumbnail', 'created_by', 'created_by_username', 'is_archived',
            'archived_by', 'archived_by_username', 'archived_at',
            'owner', 'owner_username', 'editors', 'editor_usernames', 'currently_editing_by', 'group_ids',
            'viewer_can_edit_members', 'viewer_can_edit_groups', 'viewer_can_edit_settings',
            'is_assessment', 'passing_score', 'deadline', 'my_deadline', 'created_at', 'updated_at',
        ]
        # is_archived/archived_by/archived_at/owner/editors are all
        # read-only here — they only ever change together with their own
        # audit trail, via CourseViewSet's destroy/restore/purge/
        # transfer_ownership/set_editors/set_groups actions, never a raw
        # PATCH (same reasoning as UserSerializer's equivalent fields).
        read_only_fields = [
            'id', 'created_by', 'created_by_username', 'created_at', 'updated_at',
            'is_archived', 'archived_by', 'archived_by_username', 'archived_at',
            'owner', 'owner_username', 'editors', 'editor_usernames', 'currently_editing_by', 'group_ids',
            'viewer_can_edit_members', 'viewer_can_edit_groups', 'viewer_can_edit_settings',
        ]

    def get_editor_usernames(self, obj):
        return [u.username for u in obj.editors.all()]

    def get_currently_editing_by(self, obj):
        return obj.editing_user.username if obj.is_being_edited() else None

    def get_group_ids(self, obj):
        return [g.id for g in obj.groups.all()]

    def _viewer(self):
        request = self.context.get('request')
        return request.user if request and request.user.is_authenticated else None

    def get_viewer_can_edit_members(self, obj):
        return user_can_manage_course_admin(self._viewer(), obj, 'can_edit_course_members')

    def get_viewer_can_edit_groups(self, obj):
        return user_can_manage_course_admin(self._viewer(), obj, 'can_edit_course_groups')

    def get_viewer_can_edit_settings(self, obj):
        return user_can_manage_course_admin(self._viewer(), obj, 'can_edit_course_settings')

    def get_my_deadline(self, obj):
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            return None
        return obj.effective_deadline_for(request.user)

    def validate(self, attrs):
        passing_score = attrs.get('passing_score', getattr(self.instance, 'passing_score', None))
        if passing_score is not None and not (0 <= passing_score <= 100):
            raise serializers.ValidationError({'passing_score': 'Must be between 0 and 100.'})
        return attrs


class CourseDeadlineExtensionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseDeadlineExtension
        fields = ['id', 'course', 'user', 'extended_deadline', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_fields(self):
        # `course`/`user` are only ever meant to be SET once, at creation —
        # setDeadlineExtension (frontend/src/app/actions/deadlines.ts) only
        # ever PATCHes `extended_deadline` on an existing row. Without this,
        # a manager could PATCH an existing extension's `user` (or `course`)
        # to repoint it at someone outside their own team, bypassing the
        # team check CourseDeadlineExtensionViewSet.perform_create enforces
        # on the equivalent POST — perform_create only ever runs on CREATE,
        # so a field that stays writable on UPDATE sails right past it.
        # Locking both fields read-only once an instance exists (update,
        # not create) closes that off at the serializer level, the same
        # place PrimaryKeyRelatedField's own existence validation already
        # lives, rather than trying to re-derive "is this an update" inside
        # a perform_update override.
        fields = super().get_fields()
        if self.instance is not None:
            fields['course'].read_only = True
            fields['user'].read_only = True
        return fields


class CourseAssignmentSerializer(serializers.ModelSerializer):
    # Read-only conveniences so the Members tab's table doesn't need extra
    # round-trips per row to label each assignment — same pattern
    # CourseAttemptSerializer already uses for course_id/course_name.
    username = serializers.ReadOnlyField(source='user.username')
    course_name = serializers.ReadOnlyField(source='course.name')

    class Meta:
        model = CourseAssignment
        fields = ['id', 'course', 'course_name', 'user', 'username', 'assigned_by', 'created_at']
        read_only_fields = ['id', 'assigned_by', 'created_at']


class SlideResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = SlideResult
        fields = ['id', 'attempt', 'slide', 'detail', 'is_correct', 'score']
        read_only_fields = ['id', 'attempt', 'is_correct', 'score']


# Bulk-upsert input shape for CourseAttemptViewSet.results — deliberately
# has NO is_correct/score field at all, so there is nothing for a client
# to send there even if it tried. See grading.py/SlideResult.save() for
# where those are actually computed.
class SlideResultUpsertSerializer(serializers.Serializer):
    slide = serializers.UUIDField()
    detail = serializers.JSONField(required=False, allow_null=True)


class SlideResultBulkUpsertSerializer(serializers.Serializer):
    results = SlideResultUpsertSerializer(many=True)


class CourseAttemptSerializer(serializers.ModelSerializer):
    # Read-only, nested — lets the frontend RESUME an in-progress attempt
    # (see CourseAttemptViewSet.get_queryset's course_version/status filters)
    # and rebuild its local `results` state from what was already
    # server-graded, instead of starting blank. Without this, a page refresh
    # or a new tab mid-assessment would show every slide as unanswered even
    # though the server already has a permanent, locked-in answer for it —
    # the exact same "permanent means permanent" gap the remount-bypass fix
    # closed at the component level, just one level up. The queryset this
    # serializer is used against already does .prefetch_related('slide_results'),
    # so this doesn't add an extra query per attempt.
    slide_results = SlideResultSerializer(many=True, read_only=True)
    # Read-only conveniences so a caller building a cross-course view (e.g.
    # the user detail page's course history, which lists attempts across
    # EVERY course, not one course's own analytics table which already
    # knows which course it's looking at) doesn't have to resolve
    # course_version -> course itself via extra round-trips just to label
    # each attempt.
    course_id = serializers.ReadOnlyField(source='course_version.course_id')
    course_name = serializers.ReadOnlyField(source='course_version.course.name')

    class Meta:
        model = CourseAttempt
        fields = [
            'id', 'course_version', 'course_id', 'course_name', 'user', 'status', 'started_at',
            'completed_at', 'score', 'passed', 'slide_results',
        ]
        read_only_fields = ['id', 'user', 'status', 'started_at', 'completed_at', 'score', 'passed']
