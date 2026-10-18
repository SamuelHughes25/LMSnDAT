def parse_int_pk(value):
    """Best-effort int coercion for a primary-key value arriving straight
    from request data (e.g. `request.data.get('owner')`, a list of editor
    ids) — User.id, and most of this app's other non-UUID models, use a
    plain integer AutoField. Returns None for anything that isn't cleanly
    an int, INCLUDING bool (Python's `int` is bool's superclass, so a
    stray `True`/`False` would otherwise silently coerce to 1/0 and match
    a real row) and empty/whitespace-only strings.

    Exists because handing a malformed value straight to the ORM
    (`User.objects.filter(pk=value)` / `filter(pk__in=values)`) doesn't
    fail gracefully: Django's integer-field lookups raise a bare
    `ValueError` ("Field 'id' expected a number but got ...") the moment
    the queryset is actually evaluated — unlike DRF's own
    `serializers.ValidationError`, a plain `ValueError` isn't one of the
    exception types DRF's default exception handler recognizes, so it
    reaches the client as an unhandled 500 instead of a clean 400.
    Confirmed as a real bug via a direct API call with a non-numeric
    `owner`/`editors` value against CourseViewSet/TemplateViewSet's
    transfer-ownership and set-editors actions.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return int(value)
        except ValueError:
            return None
    return None
