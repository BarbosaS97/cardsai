from django.urls import path
from . import views

urlpatterns = [
    path('credits/', views.CreditsView.as_view(), name='api_credits'),
    path('transactions/', views.TransactionListView.as_view(), name='api_transactions'),
]
