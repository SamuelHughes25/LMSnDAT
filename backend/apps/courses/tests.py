import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.accounts.models import Team, User
from apps.core.test_utils import APIAuthTestCase
from apps.courses.grading import grade_slide
from apps.courses.models import Course, CourseAttempt, CourseVersion, Lesson, Slide, SlideResult

MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=MEDIA_ROOT)
class CourseBuilderFlowTests(APIAuthTestCase):
    """End-to-end walk of the course-builder backend contract: build a
    course, author lessons/slides across the buildable slide types, reject
    bad config and non-draft writes, publish, clone into a new draft, and
    upload a course asset — mirrors templates_app's coverage for the
    Course/CourseVersion/Lesson/Slide/CourseAsset identity-version split."""

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA_ROOT, ignore_errors=True)

    def setUp(self):
        self.admin = User.objects.create_user(username='admin', password='pw', role=User.Role.ADMIN)
        self.member = User.objects.create_user(username='member', password='pw', role=User.Role.MEMBER)

    def test_full_course_builder_flow(self):
        admin_client = self.auth('admin', 'pw')
        member_client = self.auth('member', 'pw')

        # --- Course + draft creation ---
        resp = admin_client.post('/api/v1/courses/', {'name': 'Ladder Safety'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        course_id = resp.data['id']

        resp = member_client.post('/api/v1/courses/', {'name': 'nope'}, format='json')
        self.assertEqual(resp.status_code, 403)

        resp = admin_client.post(f'/api/v1/courses/{course_id}/create-draft/', format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        version_id = resp.data['id']
        self.assertEqual(resp.data['version_number'], 1)
        self.assertEqual(resp.data['status'], 'draft')
        self.assertEqual(resp.data['transition_style'], 'fade')

        # create-draft is idempotent — never creates a second draft
        resp = admin_client.post(f'/api/v1/courses/{course_id}/create-draft/', format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['id'], version_id)

        # --- Lesson CRUD ---
        resp = admin_client.post('/api/v1/lessons/', {
            'course_version': version_id, 'title': 'Intro', 'order': 0,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        lesson_id = resp.data['id']

        resp = admin_client.get(f'/api/v1/lessons/?course_version={version_id}')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.data['results']), 1)

        # --- Slide CRUD across slide types ---
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'content', 'title': 'Welcome', 'order': 0,
            'config': {'body': 'Ladders are heavy.', 'image_url': None, 'image_position': 'top'},
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        content_slide_id = resp.data['id']

        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'content', 'title': 'Second', 'order': 1,
            'config': {'body': 'Always inspect first.', 'image_url': None, 'image_position': 'top'},
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        second_slide_id = resp.data['id']

        # reorder: swap the two slides
        resp = admin_client.patch(f'/api/v1/slides/{content_slide_id}/', {'order': 1}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        resp = admin_client.patch(f'/api/v1/slides/{second_slide_id}/', {'order': 0}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

        resp = admin_client.get(f'/api/v1/slides/?lesson={lesson_id}')
        ordered_titles = [s['title'] for s in resp.data['results']]
        self.assertEqual(ordered_titles, ['Second', 'Welcome'])

        # --- multiple_choice config validation ---
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'multiple_choice', 'title': 'Bad MC', 'order': 2,
            'config': {
                'display_style': 'standard', 'question': 'Which is heaviest?',
                'options': [{'id': 'opt_1_a', 'text': 'A', 'is_correct': False}],
                'feedback_correct': '', 'feedback_incorrect': '',
            },
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)

        # too few options (1) is rejected on the min-count check, even with
        # a correct option present — a distinct failure mode from "no
        # correct option" above
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'multiple_choice', 'title': 'Too Few MC', 'order': 2,
            'config': {
                'question': 'Which is heaviest?',
                'options': [{'id': 'opt_1_a', 'text': 'A', 'is_correct': True}],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)

        # too many options (6) is rejected on the max-count check
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'multiple_choice', 'title': 'Too Many MC', 'order': 2,
            'config': {
                'question': 'Which is heaviest?',
                'options': [
                    {'id': 'opt_1_a', 'text': 'A', 'is_correct': True},
                    {'id': 'opt_2_b', 'text': 'B', 'is_correct': False},
                    {'id': 'opt_3_c', 'text': 'C', 'is_correct': False},
                    {'id': 'opt_4_d', 'text': 'D', 'is_correct': False},
                    {'id': 'opt_5_e', 'text': 'E', 'is_correct': False},
                    {'id': 'opt_6_f', 'text': 'F', 'is_correct': False},
                ],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)

        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'multiple_choice', 'title': 'Good MC', 'order': 2,
            'config': {
                'display_style': 'standard', 'question': 'Which is heaviest?',
                'options': [
                    {'id': 'opt_1_a', 'text': 'A', 'is_correct': True},
                    {'id': 'opt_2_b', 'text': 'B', 'is_correct': False},
                ],
                'feedback_correct': 'Nice.', 'feedback_incorrect': 'Try again.',
            },
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        mc_slide_id = resp.data['id']

        # --- categorize config validation ---
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'categorize', 'title': 'Bad Categorize', 'order': 3,
            'config': {
                'instructions': 'Sort these.',
                'buckets': [{'id': 'bucket_1', 'label': 'Safe'}],
                'items': [{'id': 'item_1', 'text': 'Cracked rung', 'correct_bucket_id': 'bucket_does_not_exist'}],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)

        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'categorize', 'title': 'Good Categorize', 'order': 3,
            'config': {
                'instructions': 'Sort these.',
                'buckets': [{'id': 'bucket_1', 'label': 'Safe'}, {'id': 'bucket_2', 'label': 'Unsafe'}],
                'items': [{'id': 'item_1', 'text': 'Cracked rung', 'correct_bucket_id': 'bucket_2'}],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        categorize_slide_id = resp.data['id']

        # --- missing_word config validation ---
        # a brand-new slide (empty paragraph, no blanks yet) must be
        # creatable — this is the actual initial state the builder UI sends
        # when a slide is first added, before the author has typed anything
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'missing_word', 'title': 'Fresh Missing Word', 'order': 4,
            'config': {'paragraph': '', 'blanks': []},
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        admin_client.delete(f"/api/v1/slides/{resp.data['id']}/")

        # overlapping blanks are rejected
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'missing_word', 'title': 'Bad Missing Word Overlap', 'order': 4,
            'config': {
                'paragraph': 'Always wear a hard hat and safety boots on site.',
                'blanks': [
                    {'id': 'blank_1_a1', 'start': 14, 'end': 22, 'text': 'hard hat'},
                    {'id': 'blank_2_b2', 'start': 19, 'end': 32, 'text': 'hat and safe'},
                ],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)

        # out-of-range end offset is rejected
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'missing_word', 'title': 'Bad Missing Word Range', 'order': 4,
            'config': {
                'paragraph': 'Always wear a hard hat and safety boots on site.',
                'blanks': [
                    {'id': 'blank_1_a1', 'start': 14, 'end': 999, 'text': 'hard hat'},
                ],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)

        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'missing_word', 'title': 'Good Missing Word', 'order': 4,
            'config': {
                'paragraph': 'Always wear a hard hat and safety boots on site.',
                'blanks': [
                    {'id': 'blank_1_a1', 'start': 14, 'end': 22, 'text': 'hard hat'},
                    {'id': 'blank_2_b2', 'start': 27, 'end': 39, 'text': 'safety boots'},
                ],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        missing_word_slide_id = resp.data['id']

        # --- match_pairs config validation ---
        # a brand-new slide (empty pairs list) must be creatable — the same
        # regression class as missing_word's "Fresh Missing Word" case
        # above, written and run FIRST for this slide type per the stage
        # instructions, so this exact "can't create a fresh slide" bug
        # (already hit twice) doesn't recur a third time here
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'match_pairs', 'title': 'Fresh Match Pairs', 'order': 5,
            'config': {'instructions': '', 'pairs': []},
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        admin_client.delete(f"/api/v1/slides/{resp.data['id']}/")

        # a single mid-authoring pair (about to add a second) is also
        # accepted — the backend deliberately does not enforce "at least 2"
        # at save time, only structural well-formedness (see serializers.py)
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'match_pairs', 'title': 'Mid Authoring Match Pairs', 'order': 5,
            'config': {
                'instructions': 'Match each term to its definition.',
                'pairs': [{'id': 'pair_1_x1', 'keyword': 'PPE', 'definition': ''}],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        admin_client.delete(f"/api/v1/slides/{resp.data['id']}/")

        # a pair missing its definition entirely (structurally malformed,
        # not just mid-typing) is rejected
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'match_pairs', 'title': 'Bad Match Pairs', 'order': 5,
            'config': {
                'instructions': 'Match each term to its definition.',
                'pairs': [{'id': 'pair_1_x1', 'keyword': 'PPE'}],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)

        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'match_pairs', 'title': 'Good Match Pairs', 'order': 5,
            'config': {
                'instructions': 'Match each term to its definition.',
                'pairs': [
                    {'id': 'pair_1_x1', 'keyword': 'PPE', 'definition': 'Personal Protective Equipment'},
                    {'id': 'pair_2_y2', 'keyword': 'LOTO', 'definition': 'Lockout/Tagout'},
                ],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        match_pairs_slide_id = resp.data['id']

        # --- asset upload (multipart) ---
        upload = SimpleUploadedFile('rung.jpg', b'fake-image-bytes', content_type='image/jpeg')
        resp = admin_client.post('/api/v1/course-assets/', {
            'course_version': version_id, 'file': upload, 'kind': 'image',
        }, format='multipart')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['uploaded_by'], self.admin.id)

        # --- publish ---
        resp = admin_client.post(f'/api/v1/course-versions/{version_id}/publish/', format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['status'], 'published')

        # published version content is immutable
        resp = admin_client.post('/api/v1/slides/', {
            'lesson': lesson_id, 'slide_type': 'content', 'title': 'Late add', 'order': 4, 'config': {},
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)

        resp = admin_client.post('/api/v1/lessons/', {
            'course_version': version_id, 'title': 'Late lesson', 'order': 1,
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)

        # --- clone into next draft preserves slide config ---
        resp = admin_client.post(f'/api/v1/courses/{course_id}/create-draft/', format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        draft_v2_id = resp.data['id']
        self.assertEqual(resp.data['version_number'], 2)
        self.assertEqual(resp.data['status'], 'draft')

        resp = admin_client.get(f'/api/v1/lessons/?course_version={draft_v2_id}')
        self.assertEqual(len(resp.data['results']), 1)
        cloned_lesson_id = resp.data['results'][0]['id']

        resp = admin_client.get(f'/api/v1/slides/?lesson={cloned_lesson_id}')
        cloned_by_title = {s['title']: s for s in resp.data['results']}
        self.assertEqual(len(cloned_by_title), 6)
        self.assertEqual(cloned_by_title['Good MC']['config']['options'][0]['is_correct'], True)
        self.assertEqual(
            cloned_by_title['Good Categorize']['config']['items'][0]['correct_bucket_id'], 'bucket_2'
        )
        self.assertEqual(
            cloned_by_title['Good Missing Word']['config']['blanks'][0]['text'], 'hard hat'
        )
        self.assertEqual(
            cloned_by_title['Good Match Pairs']['config']['pairs'][0]['keyword'], 'PPE'
        )
        # cloned slides are new rows, not the same ids as the published version's
        self.assertNotEqual(cloned_by_title['Good MC']['id'], mc_slide_id)
        self.assertNotEqual(cloned_by_title['Good Categorize']['id'], categorize_slide_id)
        self.assertNotEqual(cloned_by_title['Good Missing Word']['id'], missing_word_slide_id)
        self.assertNotEqual(cloned_by_title['Good Match Pairs']['id'], match_pairs_slide_id)

        # --- publishing v2 archives v1 ---
        resp = admin_client.post(f'/api/v1/course-versions/{draft_v2_id}/publish/', format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['status'], 'published')

        resp = admin_client.get(f'/api/v1/course-versions/{version_id}/')
        self.assertEqual(resp.data['status'], 'archived')

        # transition_style is immutable once a version is no longer a draft
        resp = admin_client.patch(
            f'/api/v1/course-versions/{version_id}/', {'transition_style': 'slide'}, format='json'
        )
        self.assertEqual(resp.status_code, 400, resp.content)


class GradingTests(APIAuthTestCase):
    """Unit-level coverage of grade_slide() itself, plus one API-level test
    proving the results endpoint can't be tricked into recording a false
    pass by a direct/tampered request — the actual anti-cheat property
    this whole feature exists for."""

    def setUp(self):
        self.admin = User.objects.create_user(username='grading_admin', password='pw', role=User.Role.ADMIN)
        course = Course.objects.create(name='Grading Course', created_by=self.admin)
        self.version = CourseVersion.objects.create(
            course=course, version_number=1, status=CourseVersion.Status.PUBLISHED, created_by=self.admin
        )
        self.lesson = Lesson.objects.create(course_version=self.version, title='L1', order=0)

    def make_slide(self, slide_type, config):
        return Slide.objects.create(lesson=self.lesson, slide_type=slide_type, order=0, config=config)

    def test_multiple_choice(self):
        slide = self.make_slide('multiple_choice', {
            'options': [
                {'id': 'a', 'text': 'A', 'is_correct': True},
                {'id': 'b', 'text': 'B', 'is_correct': False},
            ],
        })
        self.assertEqual(grade_slide(slide, {'selectedOptionId': 'a'}), (True, 1.0))
        self.assertEqual(grade_slide(slide, {'selectedOptionId': 'b'}), (False, 0.0))
        self.assertEqual(grade_slide(slide, {'selectedOptionId': 'does-not-exist'}), (False, 0.0))
        self.assertEqual(grade_slide(slide, {}), (False, 0.0))

    def test_missing_word_fraction_score(self):
        slide = self.make_slide('missing_word', {
            'paragraph': 'The sky is blue.',
            'blanks': [
                {'id': 'b1', 'start': 4, 'end': 7, 'text': 'sky'},
                {'id': 'b2', 'start': 11, 'end': 15, 'text': 'blue'},
            ],
        })
        self.assertEqual(grade_slide(slide, {'placements': {'b1': 'b1', 'b2': 'b2'}}), (True, 1.0))
        self.assertEqual(grade_slide(slide, {'placements': {'b1': 'b1', 'b2': 'wrong'}}), (False, 0.5))
        self.assertEqual(grade_slide(slide, {'placements': {}}), (False, 0.0))

    def test_sequencing_requires_exact_permutation(self):
        slide = self.make_slide('sequencing', {
            'sequence_items': [
                {'id': '1', 'text': 'first'}, {'id': '2', 'text': 'second'}, {'id': '3', 'text': 'third'},
            ],
        })
        self.assertEqual(grade_slide(slide, {'finalOrder': ['1', '2', '3']}), (True, 1.0))
        is_correct, score = grade_slide(slide, {'finalOrder': ['1', '3', '2']})
        self.assertFalse(is_correct)
        self.assertAlmostEqual(score, 1 / 3)
        # Malformed — missing/duplicate/unknown id — rejected outright
        # rather than partially graded.
        self.assertEqual(grade_slide(slide, {'finalOrder': ['1', '2']}), (False, 0.0))
        self.assertEqual(grade_slide(slide, {'finalOrder': ['1', '1', '2']}), (False, 0.0))
        self.assertEqual(grade_slide(slide, {'finalOrder': ['1', '2', 'nope']}), (False, 0.0))

    def test_completion_types(self):
        pairs_slide = self.make_slide('match_pairs', {'pairs': [{'id': 'p1', 'keyword': 'k', 'definition': 'd'}]})
        self.assertEqual(grade_slide(pairs_slide, {'matchedPairIds': ['p1']}), (True, 1.0))
        self.assertEqual(grade_slide(pairs_slide, {'matchedPairIds': []}), (False, 0.0))

        accordion_slide = self.make_slide('accordion', {'sections': [{'id': 's1', 'title': 't', 'body': 'b'}]})
        self.assertEqual(grade_slide(accordion_slide, {'sectionsOpened': ['s1']}), (True, 1.0))
        self.assertEqual(grade_slide(accordion_slide, {'sectionsOpened': []}), (False, 0.0))

        hotspot_slide = self.make_slide(
            'hotspot_image', {'hotspots': [{'id': 'h1', 'xPct': 10, 'yPct': 10, 'label': 'l'}]}
        )
        self.assertEqual(grade_slide(hotspot_slide, {'foundHotspotIds': ['h1']}), (True, 1.0))
        self.assertEqual(grade_slide(hotspot_slide, {'foundHotspotIds': []}), (False, 0.0))

    def test_flashcards_count_threshold(self):
        slide = self.make_slide('flashcards', {
            'cards': [{'id': 'c1', 'front': 'f', 'back': 'b'}, {'id': 'c2', 'front': 'f2', 'back': 'b2'}],
        })
        self.assertEqual(grade_slide(slide, {'cardsViewed': 2}), (True, 1.0))
        self.assertEqual(grade_slide(slide, {'cardsViewed': 1}), (False, 0.0))
        # bool is an int subclass in Python — guard against True being treated as 1.
        self.assertEqual(grade_slide(slide, {'cardsViewed': True}), (False, 0.0))

    def test_tampered_api_submission_cannot_force_a_pass(self):
        slide = self.make_slide('multiple_choice', {
            'options': [
                {'id': 'right', 'text': 'R', 'is_correct': True},
                {'id': 'wrong', 'text': 'W', 'is_correct': False},
            ],
        })
        client = self.auth('grading_admin', 'pw')
        resp = client.post('/api/v1/course-attempts/', {'course_version': str(self.version.id)}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        attempt_id = resp.data['id']

        resp = client.post(
            f'/api/v1/course-attempts/{attempt_id}/results/',
            {'results': [{'slide': str(slide.id), 'detail': {'selectedOptionId': 'wrong'}}]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(resp.data[0]['is_correct'])
        self.assertEqual(resp.data[0]['score'], 0.0)
        self.assertFalse(SlideResult.objects.get(attempt_id=attempt_id, slide=slide).is_correct)


class CourseAttemptTests(APIAuthTestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='attempt_admin', password='pw', role=User.Role.ADMIN)
        self.team = Team.objects.create(name='Attempt Team')
        self.manager = User.objects.create_user(
            username='attempt_manager', password='pw', role=User.Role.MANAGER, team=self.team
        )
        self.member = User.objects.create_user(
            username='attempt_member', password='pw', role=User.Role.MEMBER, team=self.team
        )
        self.other_member = User.objects.create_user(
            username='attempt_other', password='pw', role=User.Role.MEMBER
        )

        self.assessment_course = Course.objects.create(
            name='Assessment Course', created_by=self.admin, is_assessment=True, passing_score=70,
        )
        self.plain_course = Course.objects.create(name='Plain Course', created_by=self.admin)

        self.assessment_version = CourseVersion.objects.create(
            course=self.assessment_course, version_number=1, status=CourseVersion.Status.PUBLISHED,
            created_by=self.admin,
        )
        self.plain_version = CourseVersion.objects.create(
            course=self.plain_course, version_number=1, status=CourseVersion.Status.PUBLISHED,
            created_by=self.admin,
        )
        lesson = Lesson.objects.create(course_version=self.assessment_version, title='L1', order=0)
        self.mc_slide = Slide.objects.create(
            lesson=lesson, slide_type='multiple_choice', order=0,
            config={
                'options': [
                    {'id': 'a', 'text': 'A', 'is_correct': True}, {'id': 'b', 'text': 'B', 'is_correct': False},
                ],
            },
        )

    def test_member_only_sees_own_attempts(self):
        CourseAttempt.objects.create(course_version=self.assessment_version, user=self.member)
        CourseAttempt.objects.create(course_version=self.assessment_version, user=self.other_member)

        member_client = self.auth('attempt_member', 'pw')
        resp = member_client.get('/api/v1/course-attempts/')
        self.assertEqual(len(resp.data['results']), 1)

        manager_client = self.auth('attempt_manager', 'pw')
        resp = manager_client.get('/api/v1/course-attempts/')
        self.assertEqual(len(resp.data['results']), 1)

        admin_client = self.auth('attempt_admin', 'pw')
        resp = admin_client.get('/api/v1/course-attempts/')
        self.assertEqual(len(resp.data['results']), 2)

    def test_results_upsert_replaces_not_duplicates(self):
        member_client = self.auth('attempt_member', 'pw')
        resp = member_client.post(
            '/api/v1/course-attempts/', {'course_version': str(self.assessment_version.id)}, format='json'
        )
        attempt_id = resp.data['id']

        for _ in range(2):
            resp = member_client.post(
                f'/api/v1/course-attempts/{attempt_id}/results/',
                {'results': [{'slide': str(self.mc_slide.id), 'detail': {'selectedOptionId': 'a'}}]},
                format='json',
            )
            self.assertEqual(resp.status_code, 200, resp.content)

        self.assertEqual(SlideResult.objects.filter(attempt_id=attempt_id).count(), 1)

    def test_complete_computes_score_and_passed_for_assessment(self):
        member_client = self.auth('attempt_member', 'pw')
        resp = member_client.post(
            '/api/v1/course-attempts/', {'course_version': str(self.assessment_version.id)}, format='json'
        )
        attempt_id = resp.data['id']
        member_client.post(
            f'/api/v1/course-attempts/{attempt_id}/results/',
            {'results': [{'slide': str(self.mc_slide.id), 'detail': {'selectedOptionId': 'a'}}]},
            format='json',
        )
        resp = member_client.post(f'/api/v1/course-attempts/{attempt_id}/complete/', format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['score'], 100)
        self.assertTrue(resp.data['passed'])
        self.assertEqual(resp.data['status'], 'completed')

    def test_complete_with_no_results_leaves_score_and_passed_null(self):
        member_client = self.auth('attempt_member', 'pw')
        resp = member_client.post(
            '/api/v1/course-attempts/', {'course_version': str(self.assessment_version.id)}, format='json'
        )
        attempt_id = resp.data['id']
        resp = member_client.post(f'/api/v1/course-attempts/{attempt_id}/complete/', format='json')
        self.assertIsNone(resp.data['score'])
        self.assertIsNone(resp.data['passed'])

    def test_non_assessment_course_never_sets_passed(self):
        lesson2 = Lesson.objects.create(course_version=self.plain_version, title='L2', order=0)
        slide2 = Slide.objects.create(
            lesson=lesson2, slide_type='multiple_choice', order=0,
            config={
                'options': [
                    {'id': 'a', 'text': 'A', 'is_correct': True}, {'id': 'b', 'text': 'B', 'is_correct': False},
                ],
            },
        )
        member_client = self.auth('attempt_member', 'pw')
        resp = member_client.post(
            '/api/v1/course-attempts/', {'course_version': str(self.plain_version.id)}, format='json'
        )
        attempt_id = resp.data['id']
        member_client.post(
            f'/api/v1/course-attempts/{attempt_id}/results/',
            {'results': [{'slide': str(slide2.id), 'detail': {'selectedOptionId': 'a'}}]},
            format='json',
        )
        resp = member_client.post(f'/api/v1/course-attempts/{attempt_id}/complete/', format='json')
        self.assertEqual(resp.data['score'], 100)
        self.assertIsNone(resp.data['passed'])

    def test_cannot_submit_results_to_another_users_attempt(self):
        other_attempt = CourseAttempt.objects.create(course_version=self.assessment_version, user=self.other_member)
        member_client = self.auth('attempt_member', 'pw')
        resp = member_client.post(
            f'/api/v1/course-attempts/{other_attempt.id}/results/',
            {'results': [{'slide': str(self.mc_slide.id), 'detail': {'selectedOptionId': 'a'}}]},
            format='json',
        )
        self.assertEqual(resp.status_code, 404)
