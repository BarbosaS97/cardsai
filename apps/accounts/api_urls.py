from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from . import views

urlpatterns = [
    path('login/', views.APILoginView.as_view(), name='api_login'),
    path('register/', views.APIRegisterView.as_view(), name='api_register'),
    path('refresh/', TokenRefreshView.as_view(), name='api_token_refresh'),
    path('me/', views.CurrentUserView.as_view(), name='api_me'),
]
