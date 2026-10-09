#!/bin/sh
# Production startup sequence for the `web` service only — dev compose
# overrides `command:` with `runserver` directly (bypassing this file
# entirely), and celery-worker/celery-beat override it with their own
# celery commands (migrations/static files are irrelevant to them, and
# running migrate from three containers racing on startup is exactly the
# kind of thing to avoid). `set -e` so a failed migration or collectstatic
# stops the container instead of starting gunicorn against a half-migrated
# database.
set -e

python manage.py migrate --noinput
python manage.py collectstatic --noinput

exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3
