from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    # Web (templates + sessão)
    path('', include('apps.dashboard.urls')),
    path('', include('apps.accounts.urls')),
    # API (JWT)
    path('api/auth/', include('apps.accounts.api_urls')),
    path('api/documents/', include('apps.documents.urls')),
    path('api/billing/', include('apps.billing.urls')),
]
