import uuid
from django.db import models
from django.conf import settings


class CreditTransaction(models.Model):
    TYPE_PURCHASE = 'purchase'
    TYPE_USAGE = 'usage'
    TYPE_BONUS = 'bonus'
    TYPE_REFUND = 'refund'

    TYPE_CHOICES = [
        (TYPE_PURCHASE, 'Compra'),
        (TYPE_USAGE, 'Uso'),
        (TYPE_BONUS, 'Bônus'),
        (TYPE_REFUND, 'Reembolso'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='transactions',
    )
    amount = models.IntegerField(help_text='Positivo = adicionado, Negativo = consumido')
    transaction_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    description = models.CharField(max_length=500)
    generation = models.ForeignKey(
        'documents.Generation',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='transactions',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Transação'
        verbose_name_plural = 'Transações'

    def __str__(self):
        sign = '+' if self.amount > 0 else ''
        return f'{self.user.email}: {sign}{self.amount} ({self.get_transaction_type_display()})'
