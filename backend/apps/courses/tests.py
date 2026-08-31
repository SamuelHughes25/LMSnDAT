import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.accounts.models import User
from apps.core.test_utils import APIAuthTestCase

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
        self.assertEqual(len(cloned_by_title), 5)
        self.assertEqual(cloned_by_title['Good MC']['config']['options'][0]['is_correct'], True)
        self.assertEqual(
            cloned_by_title['Good Categorize']['config']['items'][0]['correct_bucket_id'], 'bucket_2'
        )
        self.assertEqual(
            cloned_by_title['Good Missing Word']['config']['blanks'][0]['text'], 'hard hat'
        )
        # cloned slides are new rows, not the same ids as the published version's
        self.assertNotEqual(cloned_by_title['Good MC']['id'], mc_slide_id)
        self.assertNotEqual(cloned_by_title['Good Categorize']['id'], categorize_slide_id)
        self.assertNotEqual(cloned_by_title['Good Missing Word']['id'], missing_word_slide_id)

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
