from rest_framework import serializers
from .models import CreditTransaction


class CreditTransactionSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source='get_transaction_type_display', read_only=True)
    generation_id = serializers.UUIDField(source='generation.id', read_only=True, default=None)

    class Meta:
        model = CreditTransaction
        fields = [
            'id', 'amount', 'transaction_type', 'type_display',
            'description', 'generation_id', 'created_at',
        ]
