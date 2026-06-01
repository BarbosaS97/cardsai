from django.urls import path
from . import views

urlpatterns = [
    path('', views.HomeView.as_view(), name='home'),
    path('dashboard/', views.DashboardView.as_view(), name='dashboard'),
    path('dashboard/upload/', views.UploadView.as_view(), name='upload'),
    path('dashboard/documents/', views.DocumentsView.as_view(), name='documents'),
    path('dashboard/generation/<uuid:pk>/', views.GenerationDetailView.as_view(), name='generation_detail'),
]
