from rest_framework.permissions import SAFE_METHODS, BasePermission


def _has_role(user, roles):
    return bool(user and user.is_authenticated and (user.is_superuser or user.role in roles))


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        return _has_role(request.user, {'admin'})


class IsAdminOrManager(BasePermission):
    def has_permission(self, request, view):
        return _has_role(request.user, {'admin', 'manager'})


class IsAdminOrReadOnly(BasePermission):
    """Any authenticated user can read; only Admins can write.

    Used for template/section/question endpoints — members need to read
    published template structure to render a submission form, but only
    Admins author templates.
    """

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return bool(request.user and request.user.is_authenticated)
        return _has_role(request.user, {'admin'})
