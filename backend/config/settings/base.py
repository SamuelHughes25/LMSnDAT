from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DEBUG=(bool, False),
)
environ.Env.read_env(BASE_DIR.parent / '.env')

SECRET_KEY = env('DJANGO_SECRET_KEY', default='insecure-dev-key-change-me')
DEBUG = env('DEBUG')
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['localhost', '127.0.0.1'])

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    'rest_framework',
    'rest_framework_simplejwt',
    'django_celery_beat',

    'apps.core',
    'apps.accounts',
    'apps.templates_app',
    'apps.courses',
    'apps.assignments',
    'apps.submissions',
    'apps.corrective_actions',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    # Right after SecurityMiddleware, Django's own documented placement —
    # serves collected static files (admin CSS/JS, DRF browsable-API assets)
    # straight from gunicorn with far-future cache headers, so a single
    # Droplet doesn't need a second web server (nginx) or Caddy-side static
    # config just for these. Harmless in dev too (DEBUG serves static files
    # its own way via runserver regardless of this middleware being present).
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': env.db('DATABASE_URL', default='postgres://lms:lms@db:5432/lms'),
}

AUTH_USER_MODEL = 'accounts.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = env('TIME_ZONE', default='UTC')
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_PAGINATION_CLASS': 'apps.core.pagination.DefaultPagination',
    'PAGE_SIZE': 25,
    'EXCEPTION_HANDLER': 'apps.core.exceptions.exception_handler',
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
}

# Django itself is never called directly from the browser (Next.js BFF proxies
# server-to-server), so no CORS configuration is needed here. See docs/PROJECT_LOG.md.

CELERY_BROKER_URL = env('REDIS_URL', default='redis://redis:6379/0')
CELERY_RESULT_BACKEND = env('REDIS_URL', default='redis://redis:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE
CELERY_BEAT_SCHEDULER = 'django_celery_beat.schedulers:DatabaseScheduler'

# Swappable storage: 'local' for dev, 's3' for DigitalOcean Spaces (or any S3-compatible
# provider, including AWS S3 / Azure via a compatible shim later) — config change only.
STORAGE_BACKEND = env('STORAGE_BACKEND', default='local')

# 'staticfiles' (CSS/JS/admin assets, collected by `collectstatic`) is
# ALWAYS whitenoise's compressed-manifest backend, independent of
# STORAGE_BACKEND below — that env var only ever swaps where user-uploaded
# MEDIA lives (local disk vs. Spaces), a completely separate concern from
# how static assets are served. CompressedManifestStaticFilesStorage
# gzips each file once at collectstatic time and fingerprints its name
# (e.g. `admin.a1b2c3.css`), so whitenoise can hand it out with a
# far-future cache header — safe because a content change produces a new
# filename, never a stale cache.
STORAGES = {
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}

if STORAGE_BACKEND == 's3':
    STORAGES['default'] = {'BACKEND': 'storages.backends.s3.S3Storage'}
    AWS_ACCESS_KEY_ID = env('SPACES_ACCESS_KEY_ID', default='')
    AWS_SECRET_ACCESS_KEY = env('SPACES_SECRET_ACCESS_KEY', default='')
    AWS_STORAGE_BUCKET_NAME = env('SPACES_BUCKET_NAME', default='')
    AWS_S3_ENDPOINT_URL = env('SPACES_ENDPOINT_URL', default='')
    AWS_S3_REGION_NAME = env('SPACES_REGION', default='')
    AWS_DEFAULT_ACL = 'private'
    AWS_QUERYSTRING_AUTH = True
    AWS_QUERYSTRING_EXPIRE = 3600
    # A second, PUBLIC storage for course images/thumbnails — see
    # apps/core/storage.py's own comment for the bug this exists to fix.
    # Same bucket/credentials as 'default' (still one shared bucket, see
    # CourseAsset's own comment on that tradeoff), just a different
    # ACL/querystring-auth combination: public-read + no signing, so the
    # URL this produces never expires, unlike 'default's deliberately
    # private/signed backups and learner-submitted attachment evidence.
    STORAGES['public'] = {
        'BACKEND': 'storages.backends.s3.S3Storage',
        'OPTIONS': {'default_acl': 'public-read', 'querystring_auth': False},
    }
else:
    # Explicit, not just relying on Django's implicit built-in default —
    # once STORAGES is set at all (it is, above, for 'staticfiles'), Django
    # requires every key it looks up to be present, 'default' included, or
    # `default_storage` raises InvalidStorageError the first time anything
    # touches it (confirmed: this exact gap broke the full test suite on
    # first run of this change).
    STORAGES['default'] = {'BACKEND': 'django.core.files.storage.FileSystemStorage'}
    MEDIA_URL = 'media/'
    MEDIA_ROOT = BASE_DIR / 'media'

# Error monitoring — a true no-op whenever SENTRY_DSN is unset (every local/
# test environment today), not just "configured but quiet": sentry_sdk.init()
# is simply never called, so there's zero behavior change and zero network
# calls without it. send_default_pii=False is deliberate for an audit/
# compliance platform — don't ship user PII (IPs, usernames in breadcrumbs)
# to a third-party SaaS by default.
SENTRY_DSN = env('SENTRY_DSN', default='')
if SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[DjangoIntegration(), CeleryIntegration()],
        traces_sample_rate=0.1,
        send_default_pii=False,
        environment=env('SENTRY_ENVIRONMENT', default='production'),
    )
