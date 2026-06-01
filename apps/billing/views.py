from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from .models import CreditTransaction
from .serializers import CreditTransactionSerializer
from apps.accounts.serializers import UserSerializer


class CreditsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            'credits': request.user.credits,
            'plan': request.user.plan,
            'total_generations': request.user.total_generations,
        })


class TransactionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        transactions = CreditTransaction.objects.filter(user=request.user)[:50]
        return Response(CreditTransactionSerializer(transactions, many=True).data)
