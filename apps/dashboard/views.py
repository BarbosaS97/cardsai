from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.utils.decorators import method_decorator
from django.views import View

from apps.documents.models import Document, Generation
from apps.billing.models import CreditTransaction


class HomeView(View):
    def get(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')
        return redirect('login')


@method_decorator(login_required, name='dispatch')
class DashboardView(View):
    def get(self, request):
        user = request.user
        recent_generations = Generation.objects.filter(user=user).select_related('document')[:5]
        total_docs = Document.objects.filter(user=user).count()
        context = {
            'recent_generations': recent_generations,
            'total_docs': total_docs,
            'credits': user.credits,
            'total_generations': user.total_generations,
        }
        return render(request, 'dashboard/index.html', context)


@method_decorator(login_required, name='dispatch')
class UploadView(View):
    def get(self, request):
        return render(request, 'dashboard/upload.html', {'credits': request.user.credits})


@method_decorator(login_required, name='dispatch')
class DocumentsView(View):
    def get(self, request):
        generations = (
            Generation.objects
            .filter(user=request.user)
            .select_related('document')
        )
        return render(request, 'dashboard/documents.html', {'generations': generations})


@method_decorator(login_required, name='dispatch')
class GenerationDetailView(View):
    def get(self, request, pk):
        generation = get_object_or_404(Generation, id=pk, user=request.user)
        questions = []
        flashcards = []
        if generation.status == Generation.STATUS_COMPLETED:
            questions = generation.questions.all()
            flashcards = generation.flashcards.all()
        context = {
            'generation': generation,
            'questions': questions,
            'flashcards': flashcards,
        }
        return render(request, 'dashboard/generation_detail.html', context)
