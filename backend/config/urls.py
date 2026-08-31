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
