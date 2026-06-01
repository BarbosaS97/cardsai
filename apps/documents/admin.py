from django.contrib import admin
from .models import Document, Generation, Question, Flashcard


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ['title', 'user', 'page_count', 'word_count', 'created_at']
    list_filter = ['created_at']
    search_fields = ['title', 'user__email']
    raw_id_fields = ['user']
    readonly_fields = ['created_at']


@admin.register(Generation)
class GenerationAdmin(admin.ModelAdmin):
    list_display = [
        'document', 'user', 'status', 'questions_count',
        'flashcards_count', 'credit_consumed', 'created_at',
    ]
    list_filter = ['status', 'credit_consumed', 'created_at']
    search_fields = ['document__title', 'user__email']
    raw_id_fields = ['user', 'document']
    readonly_fields = ['created_at', 'completed_at']


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ['order', 'short_question', 'topic', 'difficulty', 'correct_option']
    list_filter = ['difficulty']
    search_fields = ['question_text', 'topic']

    @admin.display(description='Questão')
    def short_question(self, obj):
        return obj.question_text[:80]


@admin.register(Flashcard)
class FlashcardAdmin(admin.ModelAdmin):
    list_display = ['order', 'short_front', 'topic']
    search_fields = ['front', 'back', 'topic']

    @admin.display(description='Frente')
    def short_front(self, obj):
        return obj.front[:80]
