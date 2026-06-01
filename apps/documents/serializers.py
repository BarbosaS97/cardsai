from rest_framework import serializers
from .models import Document, Generation, Question, Flashcard


class QuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Question
        fields = [
            'id', 'order', 'question_text',
            'option_a', 'option_b', 'option_c', 'option_d',
            'correct_option', 'explanation', 'topic', 'difficulty',
        ]


class FlashcardSerializer(serializers.ModelSerializer):
    class Meta:
        model = Flashcard
        fields = ['id', 'order', 'front', 'back', 'topic']


class GenerationStatusSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Generation
        fields = [
            'id', 'status', 'status_display', 'error_message',
            'questions_count', 'flashcards_count', 'completed_at',
        ]


class GenerationDetailSerializer(serializers.ModelSerializer):
    questions = QuestionSerializer(many=True, read_only=True)
    flashcards = FlashcardSerializer(many=True, read_only=True)
    document_title = serializers.CharField(source='document.title', read_only=True)
    document_id = serializers.UUIDField(source='document.id', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Generation
        fields = [
            'id', 'status', 'status_display', 'document_id', 'document_title',
            'summary', 'topics', 'questions_count', 'flashcards_count',
            'credit_consumed', 'created_at', 'completed_at',
            'questions', 'flashcards',
        ]


class DocumentSerializer(serializers.ModelSerializer):
    latest_generation_id = serializers.SerializerMethodField()
    latest_generation_status = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            'id', 'title', 'original_filename', 'page_count', 'word_count',
            'created_at', 'latest_generation_id', 'latest_generation_status',
        ]

    def get_latest_generation_id(self, obj):
        gen = obj.generations.first()
        return str(gen.id) if gen else None

    def get_latest_generation_status(self, obj):
        gen = obj.generations.first()
        return gen.status if gen else None
