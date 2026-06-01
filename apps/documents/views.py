import os
import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser

from .models import Document, Generation
from .serializers import (
    DocumentSerializer,
    GenerationStatusSerializer,
    GenerationDetailSerializer,
)
from .services import pdf_service
from .tasks import generate_content

logger = logging.getLogger(__name__)


class DocumentUploadView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        user = request.user

        if not user.has_credits():
            return Response(
                {'error': 'Você não tem créditos disponíveis. Adquira mais para continuar.'},
                status=402,
            )

        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'Nenhum arquivo enviado.'}, status=400)

        try:
            pdf_service.validate_file(file)
            extracted = pdf_service.extract_text(file)

            title = request.data.get('title', '').strip()
            if not title:
                title = os.path.splitext(file.name)[0][:255]

            document = Document.objects.create(
                user=user,
                title=title,
                original_filename=file.name[:255],
                page_count=extracted['page_count'],
                word_count=extracted['word_count'],
                extracted_text=extracted['text'],
            )

            generation = Generation.objects.create(
                document=document,
                user=user,
                status=Generation.STATUS_PENDING,
            )

            generate_content.delay(str(generation.id))

            return Response({
                'document_id': str(document.id),
                'generation_id': str(generation.id),
                'title': document.title,
                'page_count': document.page_count,
                'word_count': document.word_count,
                'message': 'PDF processado! A IA está gerando suas questões e flashcards...',
            }, status=201)

        except ValueError as e:
            return Response({'error': str(e)}, status=400)
        except Exception as e:
            logger.error(f'Upload error: {e}', exc_info=True)
            return Response({'error': 'Erro interno ao processar PDF. Tente novamente.'}, status=500)


class DocumentListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        docs = Document.objects.filter(user=request.user).prefetch_related('generations')
        return Response(DocumentSerializer(docs, many=True).data)


class GenerationStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            gen = Generation.objects.get(id=pk, user=request.user)
        except Generation.DoesNotExist:
            return Response({'error': 'Não encontrado.'}, status=404)
        return Response(GenerationStatusSerializer(gen).data)


class GenerationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            gen = Generation.objects.prefetch_related(
                'questions', 'flashcards'
            ).get(id=pk, user=request.user)
        except Generation.DoesNotExist:
            return Response({'error': 'Não encontrado.'}, status=404)
        return Response(GenerationDetailSerializer(gen).data)
