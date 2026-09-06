from rest_framework import serializers

from .constants import SlideType
from .models import Course, CourseAsset, CourseVersion, Lesson, Slide


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


class CourseAssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseAsset
        fields = ['id', 'course_version', 'file', 'kind', 'uploaded_by', 'created_at']
        read_only_fields = ['id', 'uploaded_by', 'created_at']


class CourseVersionSerializer(serializers.ModelSerializer):
    lessons = LessonSerializer(many=True, read_only=True)
    assets = CourseAssetSerializer(many=True, read_only=True)

    class Meta:
        model = CourseVersion
        fields = [
            'id', 'course', 'version_number', 'status', 'transition_style', 'created_by',
            'published_at', 'created_at', 'lessons', 'assets',
        ]
        read_only_fields = ['id', 'version_number', 'status', 'created_by', 'published_at', 'created_at']

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
    class Meta:
        model = Course
        fields = ['id', 'name', 'description', 'created_by', 'is_archived', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']
