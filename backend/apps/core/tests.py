import os
from datetime import timedelta
from unittest import mock

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.test import TestCase
from django.utils import timezone

from .tasks import BACKUP_PREFIX, backup_database


class BackupDatabaseTests(TestCase):
    """pg_dump itself is mocked out (no real Postgres in this test env) —
    what's under test is the storage write + retention pruning, which is
    the part actually worth regression-testing."""

    def tearDown(self):
        try:
            _, files = default_storage.listdir(BACKUP_PREFIX.rstrip('/'))
        except FileNotFoundError:
            return
        for name in files:
            default_storage.delete(f'{BACKUP_PREFIX}{name}')

    @mock.patch('apps.core.tasks.subprocess.run')
    def test_backup_writes_a_dump_file_to_storage(self, mock_run):
        mock_run.return_value = mock.Mock(stdout=b'fake-dump-bytes')

        backup_database()

        _, files = default_storage.listdir(BACKUP_PREFIX.rstrip('/'))
        self.assertEqual(len(files), 1)
        with default_storage.open(f'{BACKUP_PREFIX}{files[0]}', 'rb') as f:
            self.assertEqual(f.read(), b'fake-dump-bytes')

    @mock.patch('apps.core.tasks.subprocess.run')
    def test_old_backups_are_pruned(self, mock_run):
        mock_run.return_value = mock.Mock(stdout=b'x')

        old_path = f'{BACKUP_PREFIX}old.dump'
        default_storage.save(old_path, ContentFile(b'stale'))
        full_path = default_storage.path(old_path)
        old_time = (timezone.now() - timedelta(days=30)).timestamp()
        os.utime(full_path, (old_time, old_time))

        backup_database()

        _, files = default_storage.listdir(BACKUP_PREFIX.rstrip('/'))
        self.assertNotIn('old.dump', files)
