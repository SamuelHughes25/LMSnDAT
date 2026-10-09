from django.db.models.deletion import ProtectedError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_default_exception_handler


def exception_handler(exc, context):
    """Wraps DRF's own default handler to also cover `ProtectedError` — raised
    by Django's delete collector whenever the row being deleted is still
    referenced by an `on_delete=PROTECT` foreign key. That's the common case
    across this schema, not a rare one: Course.created_by, CourseVersion
    .created_by, CourseAttempt.user, CourseAssignment.assigned_by, Template
    .created_by, and several more (see each app's models.py) are ALL
    PROTECT, deliberately — an audit-compliance platform must never let
    deleting a user silently erase the course-completion/attempt history
    tied to them, which is exactly what CASCADE would do. But every one of
    those viewsets is a plain ModelViewSet with no destroy() override, so
    without this handler, deleting ANY user who has ever taken a course,
    created content, or been assigned one — i.e. almost any real user —
    500s with a raw, unhandled django.db.models.deletion.ProtectedError
    instead of a clean, actionable response. This is DRF's documented
    extension point for exactly this (DEFAULT_EXCEPTION_HANDLER in
    config/settings/base.py) rather than repeating a try/except in every
    individual viewset's destroy()."""
    if isinstance(exc, ProtectedError):
        blocking_models = sorted({obj.__class__.__name__ for obj in exc.protected_objects})
        reason = f"existing {', '.join(blocking_models)} records" if blocking_models else "other records"
        return Response(
            {'detail': f'Cannot delete this — it is still referenced by {reason}.'},
            status=400,
        )
    return drf_default_exception_handler(exc, context)
