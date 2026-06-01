from django.urls import path
from . import views

urlpatterns = [
    path('upload/', views.DocumentUploadView.as_view(), name='api_upload'),
    path('', views.DocumentListView.as_view(), name='api_documents'),
    path('generations/<uuid:pk>/status/', views.GenerationStatusView.as_view(), name='api_gen_status'),
    path('generations/<uuid:pk>/', views.GenerationDetailView.as_view(), name='api_gen_detail'),
]
