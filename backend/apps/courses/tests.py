import datetime
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.test import override_settings

from apps.accounts.models import Group, PermissionSet, Team, User
from apps.core.test_utils import APIAuthTestCase
from apps.courses.grading import grade_slide
from apps.courses.models import (
    Course, CourseAssignment, CourseAttempt, CourseDeadlineExtension, CourseVersion, Lesson, ReusableLesson,
    ReusableSlide, Slide, SlideResult,
)

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
        self.admin = User.objects.create_user(username='admin', password='pw', is_platform_admin=True)
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

    def test_description_length_is_capped(self):
        """Regression test for a real reported bug: an unbounded description
        forced the courses list table wider than the viewport, since a
        <TableCell> is whitespace-nowrap by default (see courses/page.tsx).
        Course.description now has max_length=300 — confirms the API
        actually rejects an overlong value rather than just the frontend
        input silently trimming it, and that the boundary itself (exactly
        300) is still accepted."""
        admin_client = self.auth('admin', 'pw')

        resp = admin_client.post(
            '/api/v1/courses/', {'name': 'Too Wordy', 'description': 'x' * 301}, format='json'
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('description', resp.data)

        resp = admin_client.post(
            '/api/v1/courses/', {'name': 'Exactly Long Enough', 'description': 'x' * 300}, format='json'
        )
        self.assertEqual(resp.status_code, 201, resp.content)


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

    def test_match_pairs_fails_overall_on_any_mismatch(self):
        slide = self.make_slide('match_pairs', {
            'pairs': [
                {'id': 'p1', 'keyword': 'k1', 'definition': 'd1'},
                {'id': 'p2', 'keyword': 'k2', 'definition': 'd2'},
            ],
        })
        # All correct.
        self.assertEqual(grade_slide(slide, {'pairings': {'p1': 'p1', 'p2': 'p2'}}), (True, 1.0))
        # One mismatch (p1 permanently landed on p2's definition) — this is
        # the "forced leftover mismatch" cascade: p2 can then only ever
        # receive p1's leftover definition, also wrong. Overall fail, but
        # partial credit reflects the one pair that was still legitimately
        # correct in a 3-pair slide (checked separately below).
        is_correct, score = grade_slide(slide, {'pairings': {'p1': 'p2', 'p2': 'p1'}})
        self.assertFalse(is_correct)
        self.assertEqual(score, 0.0)
        # Incomplete attempt (only one keyword answered so far) — never
        # "correct" while incomplete, but scores the fraction actually
        # correct rather than nothing, matching the missing_word precedent.
        is_correct, score = grade_slide(slide, {'pairings': {'p1': 'p1'}})
        self.assertFalse(is_correct)
        self.assertEqual(score, 0.5)
        # No submission at all.
        self.assertEqual(grade_slide(slide, {'pairings': {}}), (False, 0.0))
        self.assertEqual(grade_slide(slide, {}), (False, 0.0))

    def test_completion_types(self):
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

    def test_results_endpoint_rejects_a_slide_from_a_different_course(self):
        """The results endpoint must never accept a `slide` id that isn't
        actually part of THIS attempt's own course_version — otherwise a
        learner could submit a trivially-correct SlideResult for some OTHER
        course's easy slide, and complete()'s average-of-all-slide_results
        would silently count it toward THIS course's score. Grading a real
        compliance course off an answer to an unrelated course's question
        is exactly the "false pass" this whole module exists to prevent
        (see grading.py's own module docstring) — it just arrives via the
        slide id instead of a forged is_correct/score."""
        # A second, unrelated course with a trivially-satisfiable slide
        # (flashcards: graded correct the instant every card's been
        # "viewed", no right/wrong answer to even get wrong).
        other_course = Course.objects.create(name='Other Course', created_by=self.admin)
        other_version = CourseVersion.objects.create(
            course=other_course, version_number=1, status=CourseVersion.Status.PUBLISHED, created_by=self.admin,
        )
        other_lesson = Lesson.objects.create(course_version=other_version, title='L1', order=0)
        foreign_slide = Slide.objects.create(
            lesson=other_lesson, slide_type='flashcards', order=0,
            config={'cards': [{'id': 'c1', 'front': 'f', 'back': 'b'}]},
        )

        client = self.auth('grading_admin', 'pw')
        resp = client.post('/api/v1/course-attempts/', {'course_version': str(self.version.id)}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        attempt_id = resp.data['id']

        resp = client.post(
            f'/api/v1/course-attempts/{attempt_id}/results/',
            {'results': [{'slide': str(foreign_slide.id), 'detail': {'cardsViewed': 1}}]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertFalse(SlideResult.objects.filter(attempt_id=attempt_id, slide=foreign_slide).exists())

    def test_results_endpoint_rejects_a_nonexistent_slide_id(self):
        """A `slide` id that doesn't correspond to any real Slide at all
        must come back as a clean 400 (bad request), not an unhandled
        IntegrityError/500 from the FK constraint — a malformed or
        hand-crafted direct API call, not just normal UI use."""
        client = self.auth('grading_admin', 'pw')
        resp = client.post('/api/v1/course-attempts/', {'course_version': str(self.version.id)}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        attempt_id = resp.data['id']

        resp = client.post(
            f'/api/v1/course-attempts/{attempt_id}/results/',
            {'results': [{'slide': '00000000-0000-0000-0000-000000000000', 'detail': {}}]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)


class CourseAttemptTests(APIAuthTestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='attempt_admin', password='pw', is_platform_admin=True)
        self.team = Team.objects.create(name='Attempt Team')
        # No permission set — the new equivalent of "not an admin," used
        # to confirm no-Courses-tab-access means self-only visibility,
        # replacing the old role=='manager' team-scoping behavior (removed
        # — see apps.core.permissions.user_can_access_tab's own comment).
        self.manager = User.objects.create_user(username='attempt_manager', password='pw', team=self.team)
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
        self.match_pairs_slide = Slide.objects.create(
            lesson=lesson, slide_type='match_pairs', order=1,
            config={'pairs': [
                {'id': 'p1', 'keyword': 'k1', 'definition': 'd1'},
                {'id': 'p2', 'keyword': 'k2', 'definition': 'd2'},
            ]},
        )

    def test_courses_tab_access_controls_attempt_visibility(self):
        CourseAttempt.objects.create(course_version=self.assessment_version, user=self.member)
        CourseAttempt.objects.create(course_version=self.assessment_version, user=self.other_member)
        manager_attempt = CourseAttempt.objects.create(course_version=self.assessment_version, user=self.manager)

        member_client = self.auth('attempt_member', 'pw')
        resp = member_client.get('/api/v1/course-attempts/')
        self.assertEqual(len(resp.data['results']), 1)

        # No Courses tab access -> only their own, same as a plain member —
        # no more team-scoped middle tier.
        manager_client = self.auth('attempt_manager', 'pw')
        resp = manager_client.get('/api/v1/course-attempts/')
        self.assertEqual(len(resp.data['results']), 1)
        self.assertEqual(resp.data['results'][0]['id'], str(manager_attempt.id))

        admin_client = self.auth('attempt_admin', 'pw')
        resp = admin_client.get('/api/v1/course-attempts/')
        self.assertEqual(len(resp.data['results']), 3)

    def test_repeated_create_resumes_in_progress_attempt_not_duplicates(self):
        """The real bug this whole fix exists for: POSTing to /course-attempts/
        while an in_progress attempt already exists at that course version
        must resume it, not spawn another — a user's real account
        accumulated 16 attempt rows, 14 stuck in_progress, from ordinary
        revisits before this existed. Also covers the DB-level
        UniqueConstraint doing its job when perform_create's own
        check-then-create loses a race (simulated directly, since a real
        concurrent request race isn't practical to construct in a test)."""
        member_client = self.auth('attempt_member', 'pw')
        resp1 = member_client.post(
            '/api/v1/course-attempts/', {'course_version': str(self.assessment_version.id)}, format='json'
        )
        self.assertEqual(resp1.status_code, 201, resp1.content)

        resp2 = member_client.post(
            '/api/v1/course-attempts/', {'course_version': str(self.assessment_version.id)}, format='json'
        )
        self.assertEqual(resp2.status_code, 201, resp2.content)
        self.assertEqual(resp1.data['id'], resp2.data['id'])
        self.assertEqual(
            CourseAttempt.objects.filter(user=self.member, course_version=self.assessment_version).count(), 1
        )

        # The DB constraint itself: bypassing the view entirely (as if
        # perform_create's own guard had lost a race) still can't produce a
        # second in_progress row for the same (user, course_version).
        with self.assertRaises(IntegrityError), transaction.atomic():
            CourseAttempt.objects.create(user=self.member, course_version=self.assessment_version)

        # Completing the attempt frees up the constraint — a genuine retake
        # (a new in_progress attempt at the same version) is always allowed.
        CourseAttempt.objects.filter(user=self.member, course_version=self.assessment_version).update(
            status=CourseAttempt.Status.COMPLETED
        )
        CourseAttempt.objects.create(user=self.member, course_version=self.assessment_version)

    def test_course_version_and_status_filters_find_in_progress_attempt(self):
        """Covers the query the course player uses to RESUME an existing
        in_progress attempt instead of starting a new one on every visit —
        the real bug that produced a real user's 16 attempt rows (14 stuck
        in_progress) from ordinary back-and-forth browsing. Also checks the
        resumed attempt's response includes slide_results, which the
        frontend needs to restore locked-in answers into local state."""
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

        resp = member_client.get(
            f'/api/v1/course-attempts/?course_version={self.assessment_version.id}&status=in_progress'
        )
        self.assertEqual(len(resp.data['results']), 1)
        found = resp.data['results'][0]
        self.assertEqual(found['id'], attempt_id)
        self.assertEqual(len(found['slide_results']), 1)
        self.assertEqual(found['slide_results'][0]['is_correct'], True)

        # Completing it means it's no longer found by the in_progress filter
        # — the player should then start a genuinely new attempt instead.
        member_client.post(f'/api/v1/course-attempts/{attempt_id}/complete/')
        resp = member_client.get(
            f'/api/v1/course-attempts/?course_version={self.assessment_version.id}&status=in_progress'
        )
        self.assertEqual(len(resp.data['results']), 0)

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

    def test_repeated_upsert_to_same_slide_keeps_score_fresh(self):
        """Regression test for a real bug found via manual browser
        verification: Django's update_or_create() passes
        update_fields={'detail'} on every UPDATE (not CREATE) call — which,
        without SlideResult.save()'s own fix forcing is_correct/score into
        that field list, meant only the FIRST-ever submission to a given
        (attempt, slide) actually got its score written to the database;
        every later resubmission updated `detail` but silently left the old,
        now-wrong score/is_correct frozen in place. match_pairs' new
        assessment-mode design (one report per click, not just at
        completion — see match-pairs-slide-face.tsx) means this exact
        (attempt, slide) pair now legitimately gets update_or_create'd
        multiple times in normal use, so this had to actually be fixed, not
        just theoretical."""
        member_client = self.auth('attempt_member', 'pw')
        resp = member_client.post(
            '/api/v1/course-attempts/', {'course_version': str(self.assessment_version.id)}, format='json'
        )
        attempt_id = resp.data['id']

        def submit(pairings):
            return member_client.post(
                f'/api/v1/course-attempts/{attempt_id}/results/',
                {'results': [{'slide': str(self.match_pairs_slide.id), 'detail': {'pairings': pairings}}]},
                format='json',
            )

        # First click: one pair, wrong.
        resp = submit({'p1': 'p2'})
        self.assertEqual(resp.data[0]['score'], 0.0)
        # Second click: both pairs now assigned, both correct — the row
        # already exists, so this goes through update_or_create's UPDATE
        # path where the bug lived.
        resp = submit({'p1': 'p1', 'p2': 'p2'})
        self.assertEqual(resp.data[0]['score'], 1.0)
        self.assertTrue(resp.data[0]['is_correct'])

        # Still exactly one row (upsert, not a duplicate), and the DB's
        # actual stored value matches what the API just reported — not a
        # response-only artifact.
        result = SlideResult.objects.get(attempt_id=attempt_id, slide=self.match_pairs_slide)
        self.assertEqual(result.score, 1.0)
        self.assertTrue(result.is_correct)

    def test_complete_computes_score_and_passed_for_assessment(self):
        # self.assessment_version has TWO gradable slides (mc_slide,
        # match_pairs_slide) — both need a correct submission for a clean
        # 100%, now that complete() averages over every gradable slide in
        # the course rather than just the ones a learner happened to
        # submit (see that test just below for the unanswered case).
        member_client = self.auth('attempt_member', 'pw')
        resp = member_client.post(
            '/api/v1/course-attempts/', {'course_version': str(self.assessment_version.id)}, format='json'
        )
        attempt_id = resp.data['id']
        member_client.post(
            f'/api/v1/course-attempts/{attempt_id}/results/',
            {'results': [
                {'slide': str(self.mc_slide.id), 'detail': {'selectedOptionId': 'a'}},
                {'slide': str(self.match_pairs_slide.id), 'detail': {'pairings': {'p1': 'p1', 'p2': 'p2'}}},
            ]},
            format='json',
        )
        resp = member_client.post(f'/api/v1/course-attempts/{attempt_id}/complete/', format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['score'], 100)
        self.assertTrue(resp.data['passed'])
        self.assertEqual(resp.data['status'], 'completed')

    def test_complete_with_no_results_scores_zero_not_null(self):
        # A course with gradable slides always gets a real score on
        # complete() now, even if the learner answered nothing — an
        # unanswered question counts as wrong, not as excluded from the
        # average (see complete()'s own comment on why this changed: the
        # old "average only over submitted results" behavior let a learner
        # who skipped every question complete with score/passed left at
        # None, same as a course with no gradable slides at all, instead of
        # the real, failing score this is). None is reserved for a course
        # that genuinely has no gradable slides at all — see the dedicated
        # test just below this one.
        member_client = self.auth('attempt_member', 'pw')
        resp = member_client.post(
            '/api/v1/course-attempts/', {'course_version': str(self.assessment_version.id)}, format='json'
        )
        attempt_id = resp.data['id']
        resp = member_client.post(f'/api/v1/course-attempts/{attempt_id}/complete/', format='json')
        self.assertEqual(resp.data['score'], 0)
        self.assertFalse(resp.data['passed'])

    def test_complete_with_no_gradable_slides_leaves_score_and_passed_null(self):
        # The one case score/passed should still be None: a course with no
        # gradable/interactive slides at all, regardless of is_assessment.
        no_slides_version = CourseVersion.objects.create(
            course=self.assessment_course, version_number=2, status=CourseVersion.Status.DRAFT,
            created_by=self.admin,
        )
        Lesson.objects.create(course_version=no_slides_version, title='L1', order=0)
        member_client = self.auth('attempt_member', 'pw')
        resp = member_client.post(
            '/api/v1/course-attempts/', {'course_version': str(no_slides_version.id)}, format='json'
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

    def test_user_filter_and_course_name_on_cross_course_history(self):
        """Covers the query the new user detail page uses for its
        cross-course history section — every attempt for ONE user across
        every course, each one self-labeled with course_id/course_name so
        the frontend doesn't need extra round-trips."""
        CourseAttempt.objects.create(course_version=self.assessment_version, user=self.member)
        CourseAttempt.objects.create(course_version=self.plain_version, user=self.member)
        CourseAttempt.objects.create(course_version=self.assessment_version, user=self.other_member)

        admin_client = self.auth('attempt_admin', 'pw')
        resp = admin_client.get(f'/api/v1/course-attempts/?user={self.member.id}')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.data['results']), 2)
        course_names = {r['course_name'] for r in resp.data['results']}
        self.assertEqual(course_names, {'Assessment Course', 'Plain Course'})


class CourseDeadlineTests(APIAuthTestCase):
    def setUp(self):
        # Courses tab access is what controls deadline-extension management
        # now — flat/global, no team dimension any more (team-scoping
        # removed, see apps.core.permissions.user_can_access_tab's own
        # comment). deadline_manager deliberately has NO permission set,
        # replacing the old "sees/manages only their own team" tier with
        # a clean has-tab-access-or-doesn't split.
        courses_set = PermissionSet.objects.create(name='Course Manager', can_access_courses=True)
        self.admin = User.objects.create_user(username='deadline_admin', password='pw', permission_set=courses_set)
        self.team = Team.objects.create(name='Deadline Team')
        self.other_team = Team.objects.create(name='Other Deadline Team')
        self.manager = User.objects.create_user(username='deadline_manager', password='pw', team=self.team)
        self.member = User.objects.create_user(
            username='deadline_member', password='pw', role=User.Role.MEMBER, team=self.team
        )
        self.other_team_member = User.objects.create_user(
            username='deadline_other_member', password='pw', role=User.Role.MEMBER, team=self.other_team
        )
        self.course = Course.objects.create(
            name='Deadline Course', created_by=self.admin, is_assessment=True, passing_score=70,
            deadline=datetime.date(2026, 1, 31),
        )

    def test_effective_deadline_falls_back_to_course_default(self):
        self.assertEqual(self.course.effective_deadline_for(self.member), datetime.date(2026, 1, 31))

    def test_effective_deadline_uses_extension_when_present(self):
        CourseDeadlineExtension.objects.create(
            course=self.course, user=self.member, extended_deadline=datetime.date(2026, 3, 15)
        )
        self.assertEqual(self.course.effective_deadline_for(self.member), datetime.date(2026, 3, 15))
        # Someone else with no extension still gets the course's own default.
        self.assertEqual(self.course.effective_deadline_for(self.other_team_member), datetime.date(2026, 1, 31))

    def test_course_with_no_deadline_has_no_effective_deadline(self):
        plain = Course.objects.create(name='No Deadline Course', created_by=self.admin)
        self.assertIsNone(plain.effective_deadline_for(self.member))

    def test_member_cannot_create_deadline_extensions(self):
        member_client = self.auth('deadline_member', 'pw')
        resp = member_client.post(
            '/api/v1/course-deadline-extensions/',
            {'course': str(self.course.id), 'user': self.member.id, 'extended_deadline': '2026-03-15'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_courses_tab_access_can_grant_an_extension_for_any_user(self):
        admin_client = self.auth('deadline_admin', 'pw')
        resp = admin_client.post(
            '/api/v1/course-deadline-extensions/',
            {'course': str(self.course.id), 'user': self.other_team_member.id, 'extended_deadline': '2026-03-15'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_no_courses_tab_access_cannot_grant_an_extension(self):
        manager_client = self.auth('deadline_manager', 'pw')
        resp = manager_client.post(
            '/api/v1/course-deadline-extensions/',
            {'course': str(self.course.id), 'user': self.member.id, 'extended_deadline': '2026-03-15'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_no_courses_tab_access_cannot_list_extensions_at_all(self):
        # No team-scoped "sees 0 results" middle tier any more — no tab
        # access means the endpoint is closed outright, not filtered down.
        CourseDeadlineExtension.objects.create(
            course=self.course, user=self.other_team_member, extended_deadline=datetime.date(2026, 3, 15)
        )
        manager_client = self.auth('deadline_manager', 'pw')
        resp = manager_client.get(f'/api/v1/course-deadline-extensions/?course={self.course.id}')
        self.assertEqual(resp.status_code, 403)

    def test_only_one_extension_per_user_per_course(self):
        admin_client = self.auth('deadline_admin', 'pw')
        resp = admin_client.post(
            '/api/v1/course-deadline-extensions/',
            {'course': str(self.course.id), 'user': self.member.id, 'extended_deadline': '2026-03-15'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        resp = admin_client.post(
            '/api/v1/course-deadline-extensions/',
            {'course': str(self.course.id), 'user': self.member.id, 'extended_deadline': '2026-04-01'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_admin_can_set_course_deadline(self):
        admin_client = self.auth('deadline_admin', 'pw')
        resp = admin_client.patch(
            f'/api/v1/courses/{self.course.id}/', {'deadline': '2026-06-30'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.course.refresh_from_db()
        self.assertEqual(self.course.deadline, datetime.date(2026, 6, 30))

    def test_my_deadline_reflects_the_requesting_users_own_extension(self):
        """Covers the mechanism the portal side actually uses — a member
        can read their own effective deadline straight off /courses/{id}/
        without ever touching /course-deadline-extensions/, which is
        admin/manager-only."""
        member_client = self.auth('deadline_member', 'pw')
        resp = member_client.get(f'/api/v1/courses/{self.course.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['my_deadline'], datetime.date(2026, 1, 31))

        CourseDeadlineExtension.objects.create(
            course=self.course, user=self.member, extended_deadline=datetime.date(2026, 3, 15)
        )
        resp = member_client.get(f'/api/v1/courses/{self.course.id}/')
        self.assertEqual(resp.data['my_deadline'], datetime.date(2026, 3, 15))

        # A different member with no extension still just gets the course default.
        other_client = self.auth('deadline_other_member', 'pw')
        resp = other_client.get(f'/api/v1/courses/{self.course.id}/')
        self.assertEqual(resp.data['my_deadline'], datetime.date(2026, 1, 31))

    def test_courses_tab_access_can_update_any_extensions_date(self):
        extension = CourseDeadlineExtension.objects.create(
            course=self.course, user=self.member, extended_deadline=datetime.date(2026, 3, 15)
        )
        admin_client = self.auth('deadline_admin', 'pw')
        resp = admin_client.patch(
            f'/api/v1/course-deadline-extensions/{extension.id}/',
            {'extended_deadline': '2026-04-01'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        extension.refresh_from_db()
        self.assertEqual(extension.extended_deadline, datetime.date(2026, 4, 1))

    def test_cannot_repoint_an_extension_via_patch(self):
        """setDeadlineExtension (app/actions/deadlines.ts) only ever PATCHes
        `extended_deadline` — the API itself allows `user`/`course` through
        on the serializer's face, but both are read-only once an instance
        exists (see the serializer's get_fields()), so DRF just silently
        drops an attempted change to either rather than erroring — the
        contract that actually matters is that the row is untouched."""
        extension = CourseDeadlineExtension.objects.create(
            course=self.course, user=self.member, extended_deadline=datetime.date(2026, 3, 15)
        )
        admin_client = self.auth('deadline_admin', 'pw')
        resp = admin_client.patch(
            f'/api/v1/course-deadline-extensions/{extension.id}/',
            {'user': self.other_team_member.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['user'], self.member.id)
        extension.refresh_from_db()
        self.assertEqual(extension.user_id, self.member.id)

    def test_no_courses_tab_access_cannot_delete_an_extension(self):
        extension = CourseDeadlineExtension.objects.create(
            course=self.course, user=self.other_team_member, extended_deadline=datetime.date(2026, 3, 15)
        )
        manager_client = self.auth('deadline_manager', 'pw')
        resp = manager_client.delete(f'/api/v1/course-deadline-extensions/{extension.id}/')
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(CourseDeadlineExtension.objects.filter(id=extension.id).exists())


class ReusableLessonTests(APIAuthTestCase):
    """Covers the "save a lesson, import it into another course" library
    feature — a one-time CLONE in both directions (save and import), never a
    live link: editing either side afterward must never affect the other."""

    def setUp(self):
        # Courses tab access, not just course ownership — the reusable-
        # lesson library itself (e.g. deleting an entry) has no owning
        # course to grant access via (see ReusableLessonViewSet's own
        # comment), unlike save-as-reusable/import below which also work
        # via rl_admin being source_course/target_course's owner (set
        # automatically — see Course.save()'s created_by fallback).
        courses_set = PermissionSet.objects.create(name='Course Manager', can_access_courses=True)
        self.admin = User.objects.create_user(username='rl_admin', password='pw', permission_set=courses_set)
        self.member = User.objects.create_user(username='rl_member', password='pw', role=User.Role.MEMBER)

        self.source_course = Course.objects.create(name='Source Course', created_by=self.admin)
        self.source_version = CourseVersion.objects.create(
            course=self.source_course, version_number=1, status=CourseVersion.Status.DRAFT, created_by=self.admin,
        )
        self.source_lesson = Lesson.objects.create(
            course_version=self.source_version, title='Company Intro', description='Who we are.', order=0,
        )
        Slide.objects.create(
            lesson=self.source_lesson, slide_type='content', title='Welcome', order=0,
            config={'body': 'Welcome aboard.', 'image_url': None, 'image_position': 'top'},
        )
        Slide.objects.create(
            lesson=self.source_lesson, slide_type='content', title='History', order=1,
            config={'body': 'Founded in 1990.', 'image_url': None, 'image_position': 'top'},
        )

        self.target_course = Course.objects.create(name='Target Course', created_by=self.admin)
        self.target_version = CourseVersion.objects.create(
            course=self.target_course, version_number=1, status=CourseVersion.Status.DRAFT, created_by=self.admin,
        )

    def test_save_as_reusable_clones_slides_verbatim(self):
        admin_client = self.auth('rl_admin', 'pw')
        resp = admin_client.post(
            f'/api/v1/lessons/{self.source_lesson.id}/save-as-reusable/',
            {'name': 'Company Intro (reusable)', 'description': 'Shared onboarding intro.'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['name'], 'Company Intro (reusable)')
        self.assertEqual(resp.data['slide_count'], 2)

        reusable = ReusableLesson.objects.get(id=resp.data['id'])
        reusable_slides = list(reusable.slides.order_by('order'))
        self.assertEqual(len(reusable_slides), 2)
        self.assertEqual(reusable_slides[0].title, 'Welcome')
        self.assertEqual(reusable_slides[0].config, {'body': 'Welcome aboard.', 'image_url': None, 'image_position': 'top'})
        self.assertEqual(reusable_slides[1].title, 'History')

        # The source lesson/slides are untouched — this is a clone, not a move.
        self.assertEqual(self.source_lesson.slides.count(), 2)

    def test_member_cannot_save_as_reusable(self):
        member_client = self.auth('rl_member', 'pw')
        resp = member_client.post(
            f'/api/v1/lessons/{self.source_lesson.id}/save-as-reusable/', {'name': 'nope'}, format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_import_creates_independent_lesson_and_slides(self):
        admin_client = self.auth('rl_admin', 'pw')
        reusable = ReusableLesson.objects.create(name='Shared Lesson', description='', created_by=self.admin)
        ReusableSlide.objects.create(
            reusable_lesson=reusable, slide_type='content', title='Shared Slide', order=0,
            config={'body': 'Shared body.', 'image_url': None, 'image_position': 'top'},
        )

        resp = admin_client.post(
            f'/api/v1/reusable-lessons/{reusable.id}/import/',
            {'course_version': str(self.target_version.id), 'order': 0},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        new_lesson_id = resp.data['id']
        self.assertEqual(resp.data['title'], 'Shared Lesson')
        self.assertEqual(len(resp.data['slides']), 1)
        self.assertEqual(resp.data['slides'][0]['title'], 'Shared Slide')

        new_lesson = Lesson.objects.get(id=new_lesson_id)
        self.assertEqual(new_lesson.course_version_id, self.target_version.id)
        new_slide = new_lesson.slides.first()

        # Editing the imported copy must never touch the reusable source —
        # confirms this is a one-time clone, not a live link.
        new_slide.config = {'body': 'Edited in target course.', 'image_url': None, 'image_position': 'top'}
        new_slide.save(update_fields=['config'])
        reusable_slide = reusable.slides.first()
        reusable_slide.refresh_from_db()
        self.assertEqual(reusable_slide.config['body'], 'Shared body.')

    def test_cannot_import_into_a_non_draft_version(self):
        admin_client = self.auth('rl_admin', 'pw')
        reusable = ReusableLesson.objects.create(name='Shared Lesson', description='', created_by=self.admin)
        self.target_version.status = CourseVersion.Status.PUBLISHED
        self.target_version.save(update_fields=['status'])

        resp = admin_client.post(
            f'/api/v1/reusable-lessons/{reusable.id}/import/',
            {'course_version': str(self.target_version.id), 'order': 0},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_member_cannot_import(self):
        member_client = self.auth('rl_member', 'pw')
        reusable = ReusableLesson.objects.create(name='Shared Lesson', description='', created_by=self.admin)
        resp = member_client.post(
            f'/api/v1/reusable-lessons/{reusable.id}/import/',
            {'course_version': str(self.target_version.id), 'order': 0},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_delete_reusable_lesson(self):
        admin_client = self.auth('rl_admin', 'pw')
        reusable = ReusableLesson.objects.create(name='Disposable', description='', created_by=self.admin)
        resp = admin_client.delete(f'/api/v1/reusable-lessons/{reusable.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(ReusableLesson.objects.filter(id=reusable.id).exists())


class CourseAssignmentTests(APIAuthTestCase):
    """Direct per-user course assignment — coexists with (and never
    conflicts with) Group-based access. See CourseAssignment's own
    docstring: a user already covered by a Group that contains this course
    must still be assignable directly with no error — Groups routinely
    overlap on the same course."""

    def setUp(self):
        # Courses tab access, flat/global — no team dimension any more
        # (team-scoping removed, see apps.core.permissions
        # .user_can_access_tab's own comment). ca_manager deliberately has
        # no permission set, replacing the old team-scoped middle tier.
        courses_set = PermissionSet.objects.create(name='Course Manager', can_access_courses=True)
        self.admin = User.objects.create_user(username='ca_admin', password='pw', permission_set=courses_set)
        self.team = Team.objects.create(name='CA Team')
        self.other_team = Team.objects.create(name='CA Other Team')
        self.manager = User.objects.create_user(username='ca_manager', password='pw', team=self.team)
        self.member = User.objects.create_user(
            username='ca_member', password='pw', role=User.Role.MEMBER, team=self.team
        )
        self.other_team_member = User.objects.create_user(
            username='ca_other_member', password='pw', role=User.Role.MEMBER, team=self.other_team
        )
        self.course = Course.objects.create(name='CA Course', created_by=self.admin)

    def test_admin_can_assign_course_directly_to_a_user(self):
        admin_client = self.auth('ca_admin', 'pw')
        resp = admin_client.post(
            '/api/v1/course-assignments/',
            {'course': str(self.course.id), 'user': self.member.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['username'], 'ca_member')
        self.assertEqual(resp.data['course_name'], 'CA Course')
        self.assertEqual(resp.data['assigned_by'], self.admin.id)

    def test_direct_assignment_succeeds_even_when_user_already_has_course_via_a_group(self):
        """The core behavior this feature is built around: NO conflict
        error when a user already has the course through one or more
        Groups — direct assignment and group-based access coexist freely."""
        group_a = Group.objects.create(name='CA Group A')
        group_b = Group.objects.create(name='CA Group B')
        group_a.courses.add(self.course)
        group_b.courses.add(self.course)
        self.member.content_groups.add(group_a, group_b)

        admin_client = self.auth('ca_admin', 'pw')
        resp = admin_client.post(
            '/api/v1/course-assignments/',
            {'course': str(self.course.id), 'user': self.member.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(
            CourseAssignment.objects.filter(course=self.course, user=self.member).exists()
        )

    def test_member_sees_only_their_own_assignments(self):
        CourseAssignment.objects.create(course=self.course, user=self.member, assigned_by=self.admin)
        CourseAssignment.objects.create(course=self.course, user=self.other_team_member, assigned_by=self.admin)

        member_client = self.auth('ca_member', 'pw')
        resp = member_client.get('/api/v1/course-assignments/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.data['results']), 1)
        self.assertEqual(resp.data['results'][0]['user'], self.member.id)

    def test_no_courses_tab_access_sees_only_their_own_assignments(self):
        CourseAssignment.objects.create(course=self.course, user=self.member, assigned_by=self.admin)
        manager_assignment = CourseAssignment.objects.create(
            course=self.course, user=self.manager, assigned_by=self.admin
        )

        manager_client = self.auth('ca_manager', 'pw')
        resp = manager_client.get('/api/v1/course-assignments/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.data['results']), 1)
        self.assertEqual(resp.data['results'][0]['id'], str(manager_assignment.id))

    def test_no_courses_tab_access_cannot_assign_a_course_to_anyone(self):
        manager_client = self.auth('ca_manager', 'pw')
        resp = manager_client.post(
            '/api/v1/course-assignments/',
            {'course': str(self.course.id), 'user': self.other_team_member.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_member_cannot_create_an_assignment(self):
        member_client = self.auth('ca_member', 'pw')
        resp = member_client.post(
            '/api/v1/course-assignments/',
            {'course': str(self.course.id), 'user': self.member.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_delete_removes_the_assignment(self):
        assignment = CourseAssignment.objects.create(course=self.course, user=self.member, assigned_by=self.admin)
        admin_client = self.auth('ca_admin', 'pw')
        resp = admin_client.delete(f'/api/v1/course-assignments/{assignment.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(CourseAssignment.objects.filter(id=assignment.id).exists())

    def test_duplicate_assignment_is_a_clean_400_not_a_500(self):
        """The model's UniqueConstraint (course, user) must surface as a
        normal DRF validation error, not an unhandled IntegrityError — a
        double-click on the Members tab's "Add" button (two POSTs for the
        same (course, user) racing each other) is a completely ordinary
        thing for a real admin to do, not a contrived attack."""
        CourseAssignment.objects.create(course=self.course, user=self.member, assigned_by=self.admin)
        admin_client = self.auth('ca_admin', 'pw')
        resp = admin_client.post(
            '/api/v1/course-assignments/',
            {'course': str(self.course.id), 'user': self.member.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(CourseAssignment.objects.filter(course=self.course, user=self.member).count(), 1)

    def test_cannot_assign_a_nonexistent_course(self):
        admin_client = self.auth('ca_admin', 'pw')
        resp = admin_client.post(
            '/api/v1/course-assignments/',
            {'course': '00000000-0000-0000-0000-000000000000', 'user': self.member.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_cannot_assign_to_a_nonexistent_user(self):
        admin_client = self.auth('ca_admin', 'pw')
        resp = admin_client.post(
            '/api/v1/course-assignments/',
            {'course': str(self.course.id), 'user': 999999},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_unauthenticated_request_is_rejected(self):
        # self.client (APITestCase's default) carries no auth credentials.
        resp = self.client.get('/api/v1/course-assignments/')
        self.assertEqual(resp.status_code, 401)
        resp = self.client.post(
            '/api/v1/course-assignments/',
            {'course': str(self.course.id), 'user': self.member.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 401)

    def test_no_courses_tab_access_cannot_delete_any_assignment(self):
        assignment = CourseAssignment.objects.create(
            course=self.course, user=self.other_team_member, assigned_by=self.admin
        )
        manager_client = self.auth('ca_manager', 'pw')
        resp = manager_client.delete(f'/api/v1/course-assignments/{assignment.id}/')
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(CourseAssignment.objects.filter(id=assignment.id).exists())

    def test_update_is_not_allowed_at_all(self):
        """CourseAssignment is add/remove only (see the model's own
        docstring and the frontend's course-access-cell.tsx, which only
        ever POSTs or DELETEs) — PATCH/PUT must not exist as a side door
        around perform_create's team check. Without this, an admin or
        manager could PATCH an existing row's `user` (or `course`) to
        silently repoint it at someone else's team, bypassing the exact
        check perform_create enforces on the equivalent POST."""
        assignment = CourseAssignment.objects.create(course=self.course, user=self.member, assigned_by=self.admin)
        admin_client = self.auth('ca_admin', 'pw')
        resp = admin_client.patch(
            f'/api/v1/course-assignments/{assignment.id}/',
            {'user': self.other_team_member.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 405, resp.content)
        assignment.refresh_from_db()
        self.assertEqual(assignment.user_id, self.member.id)


class CourseArchiveTests(APIAuthTestCase):
    """DELETE on a course now archives instead of hard-deleting (mirrors
    TemplateViewSet/UserViewSet) — the real, final hard delete only lives
    behind the new `purge` action, which deliberately purges this course's
    CourseAttempt history across every user first, since an admin reaching
    this action has already made a deliberate, final decision."""

    def setUp(self):
        # Needs both 'archive' (destroy/restore/purge — its own tab,
        # separate from 'courses', see CourseViewSet.get_permissions's own
        # comment) and 'courses' (this suite also lists /courses/ directly
        # to confirm archived-exclusion) — is_platform_admin covers both
        # without needing two separately-reasoned-about grants.
        self.admin = User.objects.create_user(username='ar_admin', password='pw', is_platform_admin=True)
        self.member = User.objects.create_user(username='ar_member', password='pw', role=User.Role.MEMBER)
        self.course = Course.objects.create(name='Archive Me', created_by=self.admin)

    def test_delete_archives_instead_of_deleting(self):
        admin_client = self.auth('ar_admin', 'pw')
        resp = admin_client.delete(f'/api/v1/courses/{self.course.id}/')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.course.refresh_from_db()
        self.assertTrue(self.course.is_archived)
        self.assertEqual(self.course.archived_by_id, self.admin.id)
        self.assertIsNotNone(self.course.archived_at)

    def test_archived_course_is_excluded_from_the_default_list(self):
        admin_client = self.auth('ar_admin', 'pw')
        admin_client.delete(f'/api/v1/courses/{self.course.id}/')
        resp = admin_client.get('/api/v1/courses/')
        self.assertNotIn(str(self.course.id), [c['id'] for c in resp.data['results']])
        resp = admin_client.get('/api/v1/courses/?archived=true')
        self.assertIn(str(self.course.id), [c['id'] for c in resp.data['results']])

    def test_restore_brings_it_back_to_the_default_list(self):
        admin_client = self.auth('ar_admin', 'pw')
        admin_client.delete(f'/api/v1/courses/{self.course.id}/')
        resp = admin_client.post(f'/api/v1/courses/{self.course.id}/restore/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.course.refresh_from_db()
        self.assertFalse(self.course.is_archived)
        self.assertIsNone(self.course.archived_by_id)
        resp = admin_client.get('/api/v1/courses/')
        self.assertIn(str(self.course.id), [c['id'] for c in resp.data['results']])

    def test_purge_requires_archiving_first(self):
        admin_client = self.auth('ar_admin', 'pw')
        resp = admin_client.post(f'/api/v1/courses/{self.course.id}/purge/')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertTrue(Course.objects.filter(id=self.course.id).exists())

    def test_purge_deletes_the_course_and_purges_attempt_history(self):
        version = CourseVersion.objects.create(course=self.course, version_number=1, created_by=self.admin)
        CourseAttempt.objects.create(course_version=version, user=self.member)
        admin_client = self.auth('ar_admin', 'pw')
        admin_client.delete(f'/api/v1/courses/{self.course.id}/')
        resp = admin_client.post(f'/api/v1/courses/{self.course.id}/purge/')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(Course.objects.filter(id=self.course.id).exists())
        self.assertFalse(CourseAttempt.objects.filter(course_version=version).exists())

    def test_member_cannot_archive_restore_or_purge(self):
        member_client = self.auth('ar_member', 'pw')
        self.assertEqual(member_client.delete(f'/api/v1/courses/{self.course.id}/').status_code, 403)
        self.assertEqual(member_client.post(f'/api/v1/courses/{self.course.id}/restore/').status_code, 403)
        self.assertEqual(member_client.post(f'/api/v1/courses/{self.course.id}/purge/').status_code, 403)


class CourseOwnerArchivePermissionTests(APIAuthTestCase):
    """HasArchiveTabAccessOrIsOwner (apps/core/permissions.py) — a manager-
    equivalent permission set with no Archive tab granted should still be
    able to archive/restore/purge a course they personally own; anyone
    else in that same position (no Archive tab, not the owner) stays
    blocked exactly as before. Also covers restore/purge's own explicit
    check_object_permissions() call, since both bypass get_object() (to
    reach an already-archived row) and so don't get DRF's automatic
    object-level check for free the way destroy does."""

    def setUp(self):
        # Deliberately NOT given 'archive' — that's the whole point of
        # this suite: owner access has to work WITHOUT it. role=ADMIN
        # explicitly, not left at its default — role defaults to MEMBER
        # (operative), and the owner bypass this suite is testing is
        # deliberately walled off from operatives (see
        # HasArchiveTabAccessOrIsOwner's own comment) — these fixtures are
        # meant to represent an OFFICE user who just lacks the Archive
        # tab, not an operative, so leaving role at its default would
        # silently test the wrong scenario entirely.
        no_archive = PermissionSet.objects.create(
            name='No Archive', can_access_courses=True, can_access_templates=True,
        )
        self.owner = User.objects.create_user(
            username='oap_owner', password='pw', role=User.Role.ADMIN, permission_set=no_archive,
        )
        self.other = User.objects.create_user(
            username='oap_other', password='pw', role=User.Role.ADMIN, permission_set=no_archive,
        )
        self.course = Course.objects.create(name='Owner Archive Test', created_by=self.owner, owner=self.owner)

    def test_owner_without_archive_tab_can_still_archive_their_own_course(self):
        client = self.auth('oap_owner', 'pw')
        resp = client.delete(f'/api/v1/courses/{self.course.id}/')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.course.refresh_from_db()
        self.assertTrue(self.course.is_archived)

    def test_non_owner_without_archive_tab_still_blocked(self):
        client = self.auth('oap_other', 'pw')
        resp = client.delete(f'/api/v1/courses/{self.course.id}/')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.course.refresh_from_db()
        self.assertFalse(self.course.is_archived)

    def test_error_message_names_the_owner(self):
        client = self.auth('oap_other', 'pw')
        resp = client.delete(f'/api/v1/courses/{self.course.id}/')
        self.assertIn('oap_owner', resp.data['detail'])

    def test_owner_without_archive_tab_can_restore_their_own_course(self):
        self.course.is_archived = True
        self.course.save(update_fields=['is_archived'])
        client = self.auth('oap_owner', 'pw')
        resp = client.post(f'/api/v1/courses/{self.course.id}/restore/')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_non_owner_without_archive_tab_cannot_restore(self):
        self.course.is_archived = True
        self.course.save(update_fields=['is_archived'])
        client = self.auth('oap_other', 'pw')
        resp = client.post(f'/api/v1/courses/{self.course.id}/restore/')
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_owner_without_archive_tab_can_purge_their_own_course(self):
        self.course.is_archived = True
        self.course.save(update_fields=['is_archived'])
        client = self.auth('oap_owner', 'pw')
        resp = client.post(f'/api/v1/courses/{self.course.id}/purge/')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(Course.objects.filter(id=self.course.id).exists())

    def test_non_owner_without_archive_tab_cannot_purge(self):
        self.course.is_archived = True
        self.course.save(update_fields=['is_archived'])
        client = self.auth('oap_other', 'pw')
        resp = client.post(f'/api/v1/courses/{self.course.id}/purge/')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertTrue(Course.objects.filter(id=self.course.id).exists())


class CourseOwnershipTests(APIAuthTestCase):
    """Course.owner/editors open up real editing rights (course fields,
    versions, lessons, slides) to non-admins scoped to ONE specific
    course, without making them a global admin — see
    apps.core.permissions.IsContentOwnerEditorOrAdmin. A manager with
    neither relationship to the course stays as locked out as before."""

    def setUp(self):
        self.admin = User.objects.create_user(username='own_admin', password='pw', role=User.Role.ADMIN)
        # created_by=admin, owner defaults to admin too (Course.save's
        # fallback) — manually reassigned to the designated owner/editor
        # below so each test can decide who holds which role.
        self.owner = User.objects.create_user(username='own_owner', password='pw', role=User.Role.MANAGER)
        self.editor = User.objects.create_user(username='own_editor', password='pw', role=User.Role.MANAGER)
        self.outsider = User.objects.create_user(username='own_outsider', password='pw', role=User.Role.MANAGER)
        self.course = Course.objects.create(name='Owned Course', created_by=self.admin, owner=self.owner)
        self.course.editors.add(self.editor)
        self.version = CourseVersion.objects.create(course=self.course, version_number=1, created_by=self.admin)

    def test_editor_can_edit_course_fields_and_create_lesson_and_slide(self):
        editor_client = self.auth('own_editor', 'pw')
        resp = editor_client.patch(f'/api/v1/courses/{self.course.id}/', {'name': 'Renamed'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

        resp = editor_client.post(
            '/api/v1/lessons/',
            {'course_version': str(self.version.id), 'title': 'L1', 'description': '', 'order': 0},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        lesson_id = resp.data['id']

        resp = editor_client.post(
            '/api/v1/slides/',
            {'lesson': lesson_id, 'slide_type': 'content', 'title': 'S1', 'order': 0, 'config': {}},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_owner_can_edit_too(self):
        owner_client = self.auth('own_owner', 'pw')
        resp = owner_client.patch(f'/api/v1/courses/{self.course.id}/', {'name': 'Renamed'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_outsider_manager_is_blocked(self):
        outsider_client = self.auth('own_outsider', 'pw')
        resp = outsider_client.patch(f'/api/v1/courses/{self.course.id}/', {'name': 'Renamed'}, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)
        resp = outsider_client.post(
            '/api/v1/lessons/',
            {'course_version': str(self.version.id), 'title': 'L1', 'description': '', 'order': 0},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_only_the_super_super_user_can_transfer_ownership(self):
        # Tightened deliberately: transfer-ownership used to be reachable
        # by the current owner or anyone with Courses tab access
        # (IsContentOwnerOrAdmin) — now it's is_superuser only, not even
        # the owner themselves, per the user's own words: "only me the
        # super super user can take ownership of a course... no one else
        # can, even the original owner."
        editor_client = self.auth('own_editor', 'pw')
        resp = editor_client.post(
            f'/api/v1/courses/{self.course.id}/transfer-ownership/', {'owner': self.editor.id}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)

        # The owner themselves can no longer self-transfer either.
        owner_client = self.auth('own_owner', 'pw')
        resp = owner_client.post(
            f'/api/v1/courses/{self.course.id}/transfer-ownership/', {'owner': self.editor.id}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)
        self.course.refresh_from_db()
        self.assertEqual(self.course.owner_id, self.owner.id)

        # Only the super-super-user can actually do it.
        superuser = User.objects.create_user(username='own_superuser', password='pw', is_superuser=True)
        superuser_client = self.auth('own_superuser', 'pw')
        resp = superuser_client.post(
            f'/api/v1/courses/{self.course.id}/transfer-ownership/', {'owner': self.editor.id}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.course.refresh_from_db()
        self.assertEqual(self.course.owner_id, self.editor.id)

        # The old owner lost edit access; the new one (formerly just an
        # editor) now has the stricter owner-only rights too. And can't
        # transfer it back themselves either — not even to reclaim it.
        old_owner_client = self.auth('own_owner', 'pw')
        resp = old_owner_client.patch(f'/api/v1/courses/{self.course.id}/', {'name': 'x'}, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)
        resp = old_owner_client.post(
            f'/api/v1/courses/{self.course.id}/transfer-ownership/', {'owner': self.owner.id}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_transfer_ownership_rejects_malformed_or_missing_owner_cleanly(self):
        """A malformed/missing `owner` value must come back as a clean 400,
        not an unhandled 500 — User.id is an integer pk, and Django's ORM
        raises a bare ValueError (not caught by DRF's exception handler)
        the moment a non-numeric pk lookup is actually evaluated."""
        superuser = User.objects.create_user(username='own_superuser2', password='pw', is_superuser=True)
        client = self.auth('own_superuser2', 'pw')

        resp = client.post(
            f'/api/v1/courses/{self.course.id}/transfer-ownership/', {'owner': 'not-a-real-id'}, format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)

        resp = client.post(f'/api/v1/courses/{self.course.id}/transfer-ownership/', {}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)

        # Owner unchanged throughout.
        self.course.refresh_from_db()
        self.assertEqual(self.course.owner_id, self.owner.id)

    def test_only_owner_or_admin_can_set_editors(self):
        editor_client = self.auth('own_editor', 'pw')
        resp = editor_client.post(
            f'/api/v1/courses/{self.course.id}/set-editors/', {'editors': [self.outsider.id]}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)

        owner_client = self.auth('own_owner', 'pw')
        resp = owner_client.post(
            f'/api/v1/courses/{self.course.id}/set-editors/', {'editors': [self.outsider.id]}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(set(self.course.editors.values_list('id', flat=True)), {self.outsider.id})

        # Outsider is now an editor, the old editor is not (full replace).
        outsider_client = self.auth('own_outsider', 'pw')
        resp = outsider_client.patch(f'/api/v1/courses/{self.course.id}/', {'name': 'x'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

        # A malformed id anywhere in the list comes back as a clean 400,
        # not an unhandled 500 — same reasoning as transfer-ownership.
        resp = owner_client.post(
            f'/api/v1/courses/{self.course.id}/set-editors/',
            {'editors': [self.outsider.id, 'not-a-real-id']},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)


class DemotedOwnerLockoutTests(APIAuthTestCase):
    """The owner/editor bypass in user_can_edit_content, IsContentOwnerOrAdmin,
    and HasArchiveTabAccessOrIsOwner is deliberately walled off from a
    role=='member' (operative) account, even one that's still the actual
    owner/editor of a course — see each of those three's own comment on
    why. Demoting a content owner back to a plain operative must NOT
    delete or reassign their ownership (that's the whole point — it's
    ready to resume the instant real access is restored), but it DOES
    have to fully revoke their ability to act on it in the meantime,
    including through a bookmarked builder URL discovered after their
    "Courses" nav link is gone."""

    def setUp(self):
        self.owner = User.objects.create_user(username='demoted_owner', password='pw', role=User.Role.MEMBER)
        self.course = Course.objects.create(name='Demoted Owner Course', created_by=self.owner, owner=self.owner)
        self.course.editors.add(
            User.objects.create_user(username='demoted_editor', password='pw', role=User.Role.MEMBER),
        )

    def test_demoted_operative_owner_cannot_edit_their_own_course(self):
        client = self.auth('demoted_owner', 'pw')
        resp = client.patch(f'/api/v1/courses/{self.course.id}/', {'name': 'Hijacked'}, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.course.refresh_from_db()
        self.assertEqual(self.course.name, 'Demoted Owner Course')

    def test_demoted_operative_editor_cannot_edit_the_course(self):
        client = self.auth('demoted_editor', 'pw')
        resp = client.patch(f'/api/v1/courses/{self.course.id}/', {'name': 'Hijacked'}, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_demoted_operative_owner_cannot_transfer_ownership_or_set_editors(self):
        client = self.auth('demoted_owner', 'pw')
        other = User.objects.create_user(username='demoted_other', password='pw', role=User.Role.MEMBER)
        resp = client.post(
            f'/api/v1/courses/{self.course.id}/transfer-ownership/', {'owner': other.id}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)
        resp = client.post(f'/api/v1/courses/{self.course.id}/set-editors/', {'editors': [other.id]}, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_demoted_operative_owner_cannot_archive_or_purge_their_own_course(self):
        client = self.auth('demoted_owner', 'pw')
        resp = client.delete(f'/api/v1/courses/{self.course.id}/')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.course.refresh_from_db()
        self.assertFalse(self.course.is_archived)

    def test_ownership_survives_demotion_untouched_and_resumes_on_regrant(self):
        # The data-preservation half: demotion itself (already true before
        # any of this session's lockout changes — owner/editor rows are
        # never touched by a role/permission_set/is_platform_admin change)
        # plus the UI/access half: a courses-tab grant immediately restores
        # full editing, with nothing about the Course row needing to
        # change for that to work.
        self.assertEqual(self.course.owner_id, self.owner.id)
        self.owner.permission_set = PermissionSet.objects.create(name='Re-granted', can_access_courses=True)
        self.owner.save(update_fields=['permission_set'])
        client = self.auth('demoted_owner', 'pw')
        resp = client.patch(f'/api/v1/courses/{self.course.id}/', {'name': 'Resumed'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)


class CourseEditLockTests(APIAuthTestCase):
    """The soft "someone's already in the builder" lock — claim/release/
    force-takeover and the staleness window that frees an abandoned lock
    without anyone explicitly releasing it. See Course.editing_user's own
    comment for why this is deliberately NOT real-time collaborative
    editing."""

    def setUp(self):
        self.alice = User.objects.create_user(username='alice', password='pw', is_platform_admin=True)
        self.bob = User.objects.create_user(username='bob', password='pw', is_platform_admin=True)
        self.course = Course.objects.create(name='Lockable Course', owner=self.alice, created_by=self.alice)

    def test_claiming_a_free_course_succeeds_and_is_visible_on_the_course(self):
        client = self.auth('alice', 'pw')
        resp = client.post(f'/api/v1/courses/{self.course.id}/claim-edit/', format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['currently_editing_by'], 'alice')

        resp = client.get(f'/api/v1/courses/{self.course.id}/')
        self.assertEqual(resp.data['currently_editing_by'], 'alice')

    def test_second_claim_by_a_different_user_is_refused_with_409(self):
        self.auth('alice', 'pw').post(f'/api/v1/courses/{self.course.id}/claim-edit/', format='json')
        resp = self.auth('bob', 'pw').post(f'/api/v1/courses/{self.course.id}/claim-edit/', format='json')
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertEqual(resp.data['editing_by'], 'alice')

    def test_same_user_reclaiming_their_own_lock_is_fine(self):
        client = self.auth('alice', 'pw')
        client.post(f'/api/v1/courses/{self.course.id}/claim-edit/', format='json')
        # This is what the heartbeat actually does every
        # EDIT_LOCK_HEARTBEAT_SECONDS — re-claiming your own lock must
        # never be treated as a conflict.
        resp = client.post(f'/api/v1/courses/{self.course.id}/claim-edit/', format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_claim_cannot_be_forced_even_if_the_flag_is_sent(self):
        # A genuine hard lock, no override — see claim_edit's own comment
        # for why the earlier `force` escape hatch was removed outright
        # rather than just hidden from the UI: still honoring it here
        # would leave the exact same silent-data-loss risk reachable by
        # anyone who could still POST it directly.
        self.auth('alice', 'pw').post(f'/api/v1/courses/{self.course.id}/claim-edit/', format='json')
        resp = self.auth('bob', 'pw').post(
            f'/api/v1/courses/{self.course.id}/claim-edit/', {'force': True}, format='json',
        )
        self.assertEqual(resp.status_code, 409, resp.content)
        self.course.refresh_from_db()
        self.assertEqual(self.course.editing_user_id, self.alice.id)

    def test_release_clears_the_lock(self):
        client = self.auth('alice', 'pw')
        client.post(f'/api/v1/courses/{self.course.id}/claim-edit/', format='json')
        resp = client.post(f'/api/v1/courses/{self.course.id}/release-edit/', format='json')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.course.refresh_from_db()
        self.assertIsNone(self.course.editing_user_id)
        self.assertFalse(self.course.is_being_edited())

    def test_release_by_a_non_holder_does_not_clobber_the_real_holder(self):
        self.auth('alice', 'pw').post(f'/api/v1/courses/{self.course.id}/claim-edit/', format='json')
        # Bob never held the lock (his own claim would have 409'd) — a
        # stray/late release call from him must be a no-op, not something
        # that frees alice's active lock out from under her.
        resp = self.auth('bob', 'pw').post(f'/api/v1/courses/{self.course.id}/release-edit/', format='json')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.course.refresh_from_db()
        self.assertEqual(self.course.editing_user_id, self.alice.id)

    def test_stale_lock_can_be_claimed_without_force(self):
        from django.utils import timezone

        self.course.editing_user = self.alice
        self.course.editing_heartbeat_at = timezone.now() - datetime.timedelta(seconds=120)
        self.course.save(update_fields=['editing_user', 'editing_heartbeat_at'])
        resp = self.auth('bob', 'pw').post(f'/api/v1/courses/{self.course.id}/claim-edit/', format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['currently_editing_by'], 'bob')
