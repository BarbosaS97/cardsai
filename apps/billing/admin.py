from django.contrib import admin
from .models import CreditTransaction


@admin.register(CreditTransaction)
class CreditTransactionAdmin(admin.ModelAdmin):
    list_display = ['user', 'amount', 'transaction_type', 'description', 'created_at']
    list_filter = ['transaction_type', 'created_at']
    search_fields = ['user__email', 'description']
    raw_id_fields = ['user', 'generation']
    readonly_fields = ['created_at']
