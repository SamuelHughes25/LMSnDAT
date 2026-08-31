from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/auth/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/v1/auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/v1/', include('apps.accounts.urls')),
    path('api/v1/', include('apps.templates_app.urls')),
    path('api/v1/', include('apps.courses.urls')),
    path('api/v1/', include('apps.assignments.urls')),
    path('api/v1/', include('apps.submissions.urls')),
    path('api/v1/', include('apps.corrective_actions.urls')),
]

# Serves uploaded files (CourseAsset, and any future local-storage upload)
# from MEDIA_ROOT when using the 'local' STORAGE_BACKEND — Django's dev
# server never does this on its own, unlike static files under STATICFILES.
# Only wired up in DEBUG: production always runs STORAGE_BACKEND='s3'
# (DigitalOcean Spaces), which serves files directly from the bucket, not
# through Django at all. Standard Django pattern, not app-specific.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
