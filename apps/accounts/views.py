import logging
from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib import messages
from django.views import View
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework_simplejwt.tokens import RefreshToken

from .forms import RegisterForm
from .serializers import UserSerializer, RegisterSerializer

logger = logging.getLogger(__name__)


# ── Web Views (sessão) ────────────────────────────────────────────────────────

class LoginPageView(View):
    def get(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')
        return render(request, 'accounts/login.html')

    def post(self, request):
        email = request.POST.get('email', '').strip().lower()
        password = request.POST.get('password', '')
        user = authenticate(request, username=email, password=password)
        if user:
            login(request, user)
            return redirect(request.GET.get('next', '/dashboard/'))
        return render(request, 'accounts/login.html', {
            'error': 'E-mail ou senha inválidos.',
            'email': email,
        })


class RegisterPageView(View):
    def get(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')
        return render(request, 'accounts/register.html', {'form': RegisterForm()})

    def post(self, request):
        form = RegisterForm(request.POST)
        if form.is_valid():
            user = form.save()
            _grant_welcome_credits(user)
            login(request, user)
            messages.success(
                request,
                f'Bem-vindo(a), {user.first_name}! Você ganhou {user.credits} créditos grátis.'
            )
            return redirect('dashboard')
        return render(request, 'accounts/register.html', {'form': form})


class LogoutView(View):
    def post(self, request):
        logout(request)
        return redirect('login')


# ── API Views (JWT) ───────────────────────────────────────────────────────────

class APILoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        password = request.data.get('password', '')
        user = authenticate(request, username=email, password=password)
        if not user:
            return Response({'error': 'Credenciais inválidas.'}, status=400)
        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(user).data,
        })


class APIRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            _grant_welcome_credits(user)
            refresh = RefreshToken.for_user(user)
            return Response({
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'user': UserSerializer(user).data,
            }, status=201)
        return Response(serializer.errors, status=400)


class CurrentUserView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


# ── Helper ────────────────────────────────────────────────────────────────────

def _grant_welcome_credits(user):
    from django.conf import settings
    from apps.billing.models import CreditTransaction
    amount = getattr(settings, 'WELCOME_CREDITS', 3)
    user.credits = amount
    user.save(update_fields=['credits'])
    CreditTransaction.objects.create(
        user=user,
        amount=amount,
        transaction_type=CreditTransaction.TYPE_BONUS,
        description='Bônus de boas-vindas',
    )
