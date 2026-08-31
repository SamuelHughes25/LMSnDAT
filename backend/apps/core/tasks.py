import os
import subprocess
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone

# Backups land in the same storage backend as attachments (Spaces in prod,
# local filesystem in dev) under this prefix — reuses the swappable storage
# config already built for Attachment rather than provisioning a second
# bucket/credential set. See docs/PROJECT_LOG.md for the tradeoff.
BACKUP_PREFIX = 'db-backups/'
BACKUP_RETENTION_DAYS = 14


@shared_task
def backup_database():
    db = settings.DATABASES['default']
    env = {**os.environ, 'PGPASSWORD': db['PASSWORD']}

    dump = subprocess.run(
        [
            'pg_dump',
            '--host', db['HOST'],
            '--port', str(db['PORT']),
            '--username', db['USER'],
            '--format', 'custom',
            db['NAME'],
        ],
        env=env,
        capture_output=True,
        check=True,
    )

    timestamp = timezone.now().strftime('%Y%m%d-%H%M%S')
    default_storage.save(f'{BACKUP_PREFIX}{timestamp}.dump', ContentFile(dump.stdout))

    _prune_old_backups()


def _prune_old_backups():
    cutoff = timezone.now() - timedelta(days=BACKUP_RETENTION_DAYS)
    _, files = default_storage.listdir(BACKUP_PREFIX.rstrip('/'))
    for name in files:
        path = f'{BACKUP_PREFIX}{name}'
        if default_storage.get_modified_time(path) < cutoff:
            default_storage.delete(path)
