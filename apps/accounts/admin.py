from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import CustomUser


@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    list_display = ['email', 'first_name', 'credits', 'plan', 'total_generations', 'is_active', 'created_at']
    list_filter = ['plan', 'is_active', 'is_staff']
    search_fields = ['email', 'first_name']
    ordering = ['-created_at']
    fieldsets = UserAdmin.fieldsets + (
        ('CardsQuestõesIA', {'fields': ('credits', 'plan', 'total_generations')}),
    )
    readonly_fields = ['created_at', 'total_generations']
