from django.http import JsonResponse

from apps.accounts.models import User


def healthz(request):
    """Unauthenticated liveness/readiness check for Docker Compose's own
    healthcheck (gates `depends_on: condition: service_healthy` for
    celery-worker/celery-beat, which need a real DB, not just a running
    process) and any later uptime monitoring. Deliberately touches the DB
    (a cheap `.exists()`, not a full query) rather than just returning 200
    unconditionally — a process that's up but can't reach Postgres should
    fail this check, not report healthy."""
    User.objects.exists()
    return JsonResponse({'status': 'ok'})
