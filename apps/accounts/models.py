import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models


class CustomUser(AbstractUser):
    PLAN_FREE = 'free'
    PLAN_STARTER = 'starter'
    PLAN_PRO = 'pro'

    PLAN_CHOICES = [
        (PLAN_FREE, 'Gratuito'),
        (PLAN_STARTER, 'Starter'),
        (PLAN_PRO, 'Pro'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    credits = models.IntegerField(default=0)
    plan = models.CharField(max_length=20, choices=PLAN_CHOICES, default=PLAN_FREE)
    total_generations = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    class Meta:
        verbose_name = 'Usuário'
        verbose_name_plural = 'Usuários'

    def __str__(self):
        return self.email

    def has_credits(self):
        return self.credits > 0
