import uuid
from django.db import models
from django.conf import settings


class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='documents',
    )
    title = models.CharField(max_length=255)
    original_filename = models.CharField(max_length=255)
    page_count = models.IntegerField(default=0)
    word_count = models.IntegerField(default=0)
    extracted_text = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Documento'
        verbose_name_plural = 'Documentos'

    def __str__(self):
        return f'{self.title} ({self.user.email})'


class Generation(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_PROCESSING = 'processing'
    STATUS_COMPLETED = 'completed'
    STATUS_FAILED = 'failed'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Aguardando'),
        (STATUS_PROCESSING, 'Processando'),
        (STATUS_COMPLETED, 'Concluído'),
        (STATUS_FAILED, 'Falhou'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='generations')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='generations',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    error_message = models.TextField(blank=True)
    topics = models.JSONField(default=list)
    summary = models.TextField(blank=True)
    credit_consumed = models.BooleanField(default=False)
    questions_count = models.IntegerField(default=0)
    flashcards_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Geração'
        verbose_name_plural = 'Gerações'

    def __str__(self):
        return f'{self.document.title} — {self.get_status_display()}'


class Question(models.Model):
    OPTION_CHOICES = [('a', 'A'), ('b', 'B'), ('c', 'C'), ('d', 'D')]
    DIFFICULTY_CHOICES = [
        ('easy', 'Fácil'),
        ('medium', 'Médio'),
        ('hard', 'Difícil'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    generation = models.ForeignKey(Generation, on_delete=models.CASCADE, related_name='questions')
    question_text = models.TextField()
    option_a = models.TextField()
    option_b = models.TextField()
    option_c = models.TextField()
    option_d = models.TextField()
    correct_option = models.CharField(max_length=1, choices=OPTION_CHOICES)
    explanation = models.TextField(blank=True)
    topic = models.CharField(max_length=200, blank=True)
    difficulty = models.CharField(max_length=10, choices=DIFFICULTY_CHOICES, default='medium')
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f'Q{self.order + 1}: {self.question_text[:60]}'


class Flashcard(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    generation = models.ForeignKey(Generation, on_delete=models.CASCADE, related_name='flashcards')
    front = models.TextField()
    back = models.TextField()
    topic = models.CharField(max_length=200, blank=True)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f'Card {self.order + 1}: {self.front[:60]}'
