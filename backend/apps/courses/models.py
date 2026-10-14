from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.models import BaseModel
from apps.core.storage import public_media_storage
from .constants import AssetKind, SlideType, TransitionStyle

# How often the builder's client-side heartbeat refreshes the edit lock,
# and how long a lock survives with no heartbeat before it's treated as
# free again — see Course.editing_user's own comment for the full
# reasoning. The stale window is several heartbeats wide on purpose: a
# single slow/dropped request (one bad network blip) should never
# prematurely free a lock out from under someone who's still actively
# working, but a genuinely closed tab should still clear within well
# under a minute of real wall-clock time.
EDIT_LOCK_HEARTBEAT_SECONDS = 20
EDIT_LOCK_STALE_SECONDS = 60


class Course(BaseModel):
    name = models.CharField(max_length=255)
    # Capped — an unbounded description reported as a real layout bug: a
    # long one forced the courses list table's Description column (and with
    # it, the whole table) wider than the viewport, since a <TableCell> is
    # `whitespace-nowrap` by default (see courses/page.tsx). 300 is a short
    # blurb's worth (roughly two sentences) — enough for a real description,
    # short enough to never need more than the truncated single line the
    # list page gives it.
    description = models.TextField(blank=True, max_length=300)
    # SET_NULL, not PROTECT: `owner` below is now the field that actually
    # represents "who's responsible for this course" and determines
    # whether deleting a user is blocked (see UserViewSet.purge) —
    # created_by is just a historical "who originally clicked New Course"
    # footnote, never read anywhere outside a couple of display-only
    # serializer fields and the Django admin list, so there's nothing
    # audit-critical lost by letting it go null. Keeping this PROTECT would
    # otherwise silently defeat the entire point of a transferable owner:
    # transferring ownership away is supposed to be what unblocks purging
    # the original owner, but if they're also still this course's
    # permanent created_by, that PROTECT would keep blocking them anyway.
    created_by = models.ForeignKey(
        'accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='courses_created'
    )
    # Transferable — unlike created_by above, this is "who's currently in
    # charge of this course" and can be handed off
    # (CourseViewSet.transfer_ownership). Always set on creation (same user
    # as created_by, see perform_create) and backfilled from created_by for
    # every pre-existing row — see migration 0012. PROTECT: deleting an
    # owner outright must not silently orphan a course — UserViewSet.purge
    # checks this field specifically to decide whether a user's content
    # needs reassigning before they can be removed for good.
    owner = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='courses_owned')
    # Granted per-course edit rights (course fields, versions, lessons,
    # slides, assets — see apps.core.permissions.IsContentOwnerEditorOrAdmin)
    # without needing the global admin role. Only the owner or an admin can
    # change this list (CourseViewSet.set_editors) — an editor can't add
    # other editors themselves.
    editors = models.ManyToManyField('accounts.User', blank=True, related_name='courses_editing')
    is_archived = models.BooleanField(default=False)
    # Who archived this course and when — SET_NULL (not PROTECT) since this
    # is purely an audit convenience, not a safety-critical reference; it
    # should never be the thing blocking a user's own deletion. Both are
    # cleared on restore and reset on every subsequent archive, so they
    # always describe the CURRENT archive, not some past one.
    archived_by = models.ForeignKey(
        'accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    archived_at = models.DateTimeField(null=True, blank=True)
    # Whole-course, not per-version (same level as is_archived) — marks this
    # course as a scored assessment rather than free-form training content.
    # passing_score is a 0-100 percentage, only meaningful when True; a
    # CourseAttempt's own `passed` stays null whenever this is False, no
    # matter what score was achieved (see CourseAttemptViewSet.complete).
    is_assessment = models.BooleanField(default=False)
    passing_score = models.PositiveSmallIntegerField(null=True, blank=True)
    # The default due date for this course — deliberately INDEPENDENT of
    # is_assessment (unlike passing_score, which is meaningless without a
    # score to check against a threshold): a purely informative course with
    # no questions at all can still need a "watch this in your first week"
    # deadline, e.g. an onboarding video. Applies to everyone who can see
    # the course unless a CourseDeadlineExtension below gives a specific
    # user a later date (e.g. a genuine extension request) — see
    # effective_deadline_for(). "Done" for deadline-overdue purposes means
    # a passed attempt when is_assessment, else just any completed attempt
    # — see the frontend's Dashboard overdue widget and portal reminders,
    # both of which branch on is_assessment for exactly this reason.
    deadline = models.DateField(null=True, blank=True)
    # A course-level picture, independent of any CourseVersion (unlike
    # CourseAsset below, which belongs to one draft/published version) —
    # this needs to be settable at course-CREATE time, before any version
    # exists at all, and should survive a course through every future draft
    # rather than needing to be re-set per version. Purely cosmetic (the
    # portal's "Normal" course list view and nowhere else, currently) — no
    # code should ever treat a missing thumbnail as an error state. Plain
    # FileField, not ImageField, matching CourseAsset.file below — ImageField
    # would need Pillow, an otherwise-unneeded dependency for this project;
    # the frontend picker already restricts the file input to `accept="image/*"`.
    thumbnail = models.FileField(
        upload_to='course-thumbnails/%Y/%m/', null=True, blank=True, storage=public_media_storage
    )

    # Soft "someone's already in the builder for this course" lock — NOT
    # real-time collaborative editing (two people's changes merging live).
    # That's explicitly out of scope: it's a lot of ongoing complexity
    # (conflict resolution, live cursors, offline merge) this app has no
    # real need for with a handful of internal authors, and it's easy to
    # get subtly wrong in ways that corrupt content. This is the much
    # simpler, much more robust alternative: whoever opens the builder
    # claims the lock (CourseViewSet.claim_edit), a client-side heartbeat
    # (every EDIT_LOCK_HEARTBEAT_SECONDS) keeps it fresh while they're
    # still there, and it's considered free again once
    # EDIT_LOCK_STALE_SECONDS passes with no heartbeat — see
    # is_being_edited() below. That staleness window is what makes this
    # safe against someone just closing the tab/losing their connection
    # instead of cleanly releasing it (CourseViewSet.release_edit): no
    # heartbeat ever arrives again, so the lock expires on its own rather
    # than permanently locking the course. SET_NULL, not PROTECT — losing
    # track of who was last editing is not a reason to block deleting that
    # user.
    editing_user = models.ForeignKey(
        'accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    editing_heartbeat_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        # Falls back to created_by when owner isn't explicitly set — the
        # same backfill semantics migration 0013 applied to every
        # pre-existing row, just applied forever here too, so any code
        # path that creates a Course without thinking about `owner`
        # specifically (tests, scripts, a future call site) still gets a
        # sane value instead of hitting the NOT NULL constraint. The real,
        # intentional "owner starts as the creator" case already sets both
        # explicitly (see CourseViewSet.perform_create) — this only
        # matters when owner is left unset.
        if self.owner_id is None and self.created_by_id is not None:
            self.owner_id = self.created_by_id
        super().save(*args, **kwargs)

    @property
    def published_version(self):
        return self.versions.filter(status=CourseVersion.Status.PUBLISHED).order_by('-version_number').first()

    def is_being_edited(self):
        # The one place that actually interprets the raw editing_user/
        # editing_heartbeat_at fields against EDIT_LOCK_STALE_SECONDS —
        # every other reader (the serializer, claim_edit) goes through
        # this rather than re-deriving the same staleness check, so there
        # is exactly one definition of "is this lock still good."
        if self.editing_user_id is None or self.editing_heartbeat_at is None:
            return False
        age = (timezone.now() - self.editing_heartbeat_at).total_seconds()
        return age < EDIT_LOCK_STALE_SECONDS

    def effective_deadline_for(self, user):
        """This course's real due date for a specific user — their own
        CourseDeadlineExtension if one exists (an admin/manager granting
        more time), else the course's own default `deadline`. Never
        queries anything if the course has no deadline at all (the common
        case for non-assessment courses)."""
        if self.deadline is None:
            return None
        extension = self.deadline_extensions.filter(user=user).first()
        return extension.extended_deadline if extension else self.deadline


class CourseVersion(BaseModel):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        ARCHIVED = 'archived', 'Archived'

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='versions')
    version_number = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='course_versions_created'
    )
    published_at = models.DateTimeField(null=True, blank=True)
    # Course-wide authored setting for learner-facing slide-to-slide transitions
    # in Preview mode / the future learner player. No TemplateVersion analog.
    transition_style = models.CharField(
        max_length=20, choices=TransitionStyle.choices, default=TransitionStyle.FADE
    )

    class Meta:
        ordering = ['course', '-version_number']
        constraints = [
            models.UniqueConstraint(
                fields=['course', 'version_number'], name='unique_version_number_per_course'
            ),
            # Enforced in the DB, not just the service layer: a course can
            # only ever have one draft in flight at a time.
            models.UniqueConstraint(
                fields=['course'], condition=Q(status='draft'), name='one_draft_per_course'
            ),
        ]

    def __str__(self):
        return f'{self.course.name} v{self.version_number} ({self.status})'


class Lesson(BaseModel):
    course_version = models.ForeignKey(CourseVersion, on_delete=models.CASCADE, related_name='lessons')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['course_version', 'order']

    def __str__(self):
        return self.title


class Slide(BaseModel):
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name='slides')
    slide_type = models.CharField(max_length=30, choices=SlideType.choices)
    # Canvas label for the slide in the builder — not shown to the learner.
    title = models.CharField(max_length=255, blank=True)
    order = models.PositiveIntegerField(default=0)
    # Type-specific content (body text, options, buckets/items, etc).
    config = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['lesson', 'order']

    def __str__(self):
        return self.title or f'{self.get_slide_type_display()} slide'


class CourseDeadlineExtension(BaseModel):
    """A per-user override of a course's default `deadline` — the escape
    hatch for "this one person genuinely needs more time" without moving
    the deadline for everyone else. At most one per (course, user); see
    Course.effective_deadline_for() for how this is actually resolved."""

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='deadline_extensions')
    user = models.ForeignKey('accounts.User', on_delete=models.CASCADE, related_name='course_deadline_extensions')
    extended_deadline = models.DateField()

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(fields=['course', 'user'], name='one_deadline_extension_per_user_per_course'),
        ]

    def __str__(self):
        return f'{self.user_id} extended to {self.extended_deadline} on {self.course_id}'


class CourseAssignment(BaseModel):
    """A course directly assigned to one specific user, independent of
    Group membership (see accounts.Group.courses for the indirect path) —
    the two mechanisms freely coexist, including overlapping (a user can
    hold this AND be in one or more Groups that also contain the course —
    that's expected, not an error; Groups routinely share courses with each
    other, e.g. a company-wide safety course in many job-role groups).
    Portal-side de-duplication (showing the course exactly once regardless
    of how many sources grant it) is handled by the frontend's
    role-access.ts Set-based union, not here — this model has no
    "already assigned another way" validation at all."""

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='direct_assignments')
    user = models.ForeignKey('accounts.User', on_delete=models.CASCADE, related_name='course_assignments')
    assigned_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='course_assignments_made'
    )

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(fields=['course', 'user'], name='one_direct_assignment_per_user_per_course'),
        ]

    def __str__(self):
        return f'{self.user_id} directly assigned to {self.course_id}'


class CourseAttempt(BaseModel):
    """One operative's attempt at a specific, immutable CourseVersion —
    structurally mirrors apps.submissions.Submission (parent "who, which
    version, status, timestamps" record) but lives in this app since
    there's no separate assignment-gating concept for courses the way
    Submission has Assignment. score/passed are set only once, in
    CourseAttemptViewSet.complete(), computed from this attempt's own
    (server-graded — see grading.py) SlideResult rows, never trusted from
    the client.
    """

    class Status(models.TextChoices):
        IN_PROGRESS = 'in_progress', 'In progress'
        COMPLETED = 'completed', 'Completed'

    course_version = models.ForeignKey(CourseVersion, on_delete=models.PROTECT, related_name='attempts')
    user = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='course_attempts')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_PROGRESS)
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # 0-100, set on completion from this attempt's own SlideResult rows.
    score = models.PositiveSmallIntegerField(null=True, blank=True)
    # Null unless the course is an assessment AND a score was computed —
    # never set to False just because the course isn't scored.
    passed = models.BooleanField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']
        constraints = [
            # Backs CourseAttemptViewSet.perform_create's resume-or-create
            # logic — a DB-level guarantee (not just an application-level
            # check) that a user can never end up with two in_progress
            # attempts at the same course version, closing the race window
            # between two truly concurrent create requests (two tabs, or
            # dev's Strict Mode double-invoked mount effect) that an
            # in-Python check-then-create can't close on its own. Only
            # applies to in_progress rows — a user can have any number of
            # COMPLETED attempts (retakes), just never more than one
            # unfinished one at a time.
            models.UniqueConstraint(
                fields=['user', 'course_version'],
                condition=models.Q(status='in_progress'),
                name='one_in_progress_attempt_per_user_per_version',
            ),
        ]

    def __str__(self):
        return f'CourseAttempt {self.id} ({self.status})'


class SlideResult(BaseModel):
    """One interactive slide's result within a CourseAttempt. `detail` is
    the ONLY thing the client ever submits — the raw, type-specific answer
    payload each slide face's present mode already sends to onInteraction
    (see frontend/src/lib/slide-interaction.ts and grading.py's own module
    docstring for the exact shape per slide_type). is_correct/score are
    NOT client-writable: save() always recomputes them server-side via
    grade_slide(), the same "derive correctness from the raw submitted
    value, never trust a client-sent flag" pattern already established by
    apps.submissions.Answer.save()'s requires_action computation. Frozen at
    whatever grading.py said at submit time — a later change to the
    grading logic doesn't retroactively alter past compliance records.
    """

    attempt = models.ForeignKey(CourseAttempt, on_delete=models.CASCADE, related_name='slide_results')
    slide = models.ForeignKey(Slide, on_delete=models.CASCADE, related_name='results')
    detail = models.JSONField(null=True, blank=True)
    is_correct = models.BooleanField(editable=False)
    score = models.FloatField(editable=False)  # 0-1 fraction

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['attempt', 'slide'], name='unique_result_per_slide_per_attempt'),
        ]

    def __str__(self):
        return f'SlideResult for slide {self.slide_id} on attempt {self.attempt_id}'

    def save(self, *args, **kwargs):
        from .grading import grade_slide

        self.is_correct, self.score = grade_slide(self.slide, self.detail)
        # `update_or_create(..., defaults={'detail': ...})` — the results
        # view's own upsert call, and match_pairs' assessment-mode design
        # now means the SAME (attempt, slide) row gets update_or_create'd
        # repeatedly, once per click — passes `update_fields={'detail'}` on
        # every UPDATE (not CREATE) it does. Django's update_fields, when
        # given, restricts the actual SQL UPDATE to exactly those columns —
        # so without this, the is_correct/score just recomputed above would
        # be set correctly in memory but silently NEVER reach the database
        # on any update after the first (confirmed in a real browser: the
        # match_pairs `detail` column ended up with the final, complete
        # pairings, but `score` was frozen at whatever it was after the
        # very first click). Force is_correct/score into whatever field
        # list was requested so a derived field can never go stale this
        # way — the same latent gap exists in apps.submissions.Answer.save()'s
        # requires_action, worth fixing there too if it's ever hit the same
        # way, but out of scope for this pass.
        update_fields = kwargs.get('update_fields')
        if update_fields is not None:
            kwargs['update_fields'] = set(update_fields) | {'is_correct', 'score'}
        super().save(*args, **kwargs)


class ReusableLesson(BaseModel):
    """A saved, standalone copy of a Lesson's slides — the library entry
    behind "save this lesson, import it into other courses" (e.g. a company-
    introduction lesson reused across many courses without re-authoring it
    each time). Deliberately NOT a FK back to the Lesson it was saved from:
    importing a ReusableLesson clones ITS OWN slides into a brand new Lesson
    (see services.import_reusable_lesson), so a ReusableLesson is a fully
    independent, standing library item — editing or deleting the original
    source lesson later, or any course that previously imported this one,
    never touches it or vice versa. `name`/`description` are the library
    entry's own label, independent of whatever the source lesson happened to
    be titled at save time.
    """

    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT, related_name='reusable_lessons_created'
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class ReusableSlide(BaseModel):
    """Mirrors Slide exactly (slide_type/title/order/config), just parented
    to a ReusableLesson instead of a Lesson — see ReusableLesson's own
    docstring for why this is a separate, non-FK-linked table rather than
    reusing Slide directly."""

    reusable_lesson = models.ForeignKey(ReusableLesson, on_delete=models.CASCADE, related_name='slides')
    slide_type = models.CharField(max_length=30, choices=SlideType.choices)
    title = models.CharField(max_length=255, blank=True)
    order = models.PositiveIntegerField(default=0)
    config = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['reusable_lesson', 'order']

    def __str__(self):
        return self.title or f'{self.get_slide_type_display()} slide'


class CourseAsset(BaseModel):
    # Shared reusable media library per draft — not per-slide. Slide.config
    # stores the resulting asset URL as a plain string (e.g. config.image_url),
    # matching how Slide/Question config already store literal values rather
    # than cross-references. Known tradeoff: no DB-level orphaned-asset
    # cleanup — same style as the existing shared-bucket tradeoffs already
    # noted in docs/PROJECT_LOG.md.
    course_version = models.ForeignKey(CourseVersion, on_delete=models.CASCADE, related_name='assets')
    file = models.FileField(upload_to='course-assets/%Y/%m/', storage=public_media_storage)
    kind = models.CharField(max_length=20, choices=AssetKind.choices, default=AssetKind.OTHER)
    uploaded_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='course_assets_uploaded')

    def __str__(self):
        return self.file.name
