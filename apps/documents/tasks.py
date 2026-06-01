import logging
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=120,
    name='documents.generate_content',
)
def generate_content(self, generation_id: str):
    from apps.documents.models import Generation, Question, Flashcard
    from apps.documents.services import ai_service
    from apps.billing.models import CreditTransaction

    try:
        generation = Generation.objects.select_related('document', 'user').get(id=generation_id)
    except Generation.DoesNotExist:
        logger.error(f'Generation {generation_id} not found')
        return

    if generation.status not in (Generation.STATUS_PENDING, Generation.STATUS_FAILED):
        logger.warning(f'Generation {generation_id} already in status: {generation.status}')
        return

    generation.status = Generation.STATUS_PROCESSING
    generation.error_message = ''
    generation.save(update_fields=['status', 'error_message'])

    try:
        text = generation.document.extracted_text
        if not text:
            raise ValueError('Texto do documento não disponível. Faça o upload novamente.')

        result = ai_service.generate_study_materials(text)

        # Salvar questões em lote
        questions = [
            Question(
                generation=generation,
                question_text=q.get('question', ''),
                option_a=q.get('option_a', ''),
                option_b=q.get('option_b', ''),
                option_c=q.get('option_c', ''),
                option_d=q.get('option_d', ''),
                correct_option=(q.get('correct_option', 'a') or 'a').lower()[:1],
                explanation=q.get('explanation', ''),
                topic=str(q.get('topic', ''))[:200],
                difficulty=(q.get('difficulty', 'medium') or 'medium').lower()[:10],
                order=i,
            )
            for i, q in enumerate(result['questions'])
        ]
        Question.objects.bulk_create(questions)

        # Salvar flashcards em lote
        flashcards = [
            Flashcard(
                generation=generation,
                front=f.get('front', ''),
                back=f.get('back', ''),
                topic=str(f.get('topic', ''))[:200],
                order=i,
            )
            for i, f in enumerate(result['flashcards'])
        ]
        Flashcard.objects.bulk_create(flashcards)

        # Marcar geração como concluída
        generation.status = Generation.STATUS_COMPLETED
        generation.summary = result.get('summary', '')
        generation.topics = result.get('topics', [])
        generation.questions_count = len(questions)
        generation.flashcards_count = len(flashcards)
        generation.completed_at = timezone.now()
        generation.credit_consumed = True
        generation.save()

        # ✅ Debitar crédito SOMENTE após sucesso confirmado
        user = generation.user
        user.credits -= 1
        user.total_generations += 1
        user.save(update_fields=['credits', 'total_generations'])

        CreditTransaction.objects.create(
            user=user,
            amount=-1,
            transaction_type=CreditTransaction.TYPE_USAGE,
            description=f'Geração: {generation.document.title}',
            generation=generation,
        )

        # Limpar texto extraído para economizar espaço no banco
        generation.document.extracted_text = ''
        generation.document.save(update_fields=['extracted_text'])

        logger.info(
            f'Geração {generation_id} concluída: '
            f'{len(questions)} questões, {len(flashcards)} flashcards'
        )

    except Exception as exc:
        logger.error(f'Geração {generation_id} falhou: {exc}', exc_info=True)
        generation.status = Generation.STATUS_FAILED
        generation.error_message = str(exc)[:1000]
        generation.save(update_fields=['status', 'error_message'])

        # Retry automático em erros de API transientes
        error_lower = str(exc).lower()
        if any(kw in error_lower for kw in ('rate_limit', 'timeout', 'connection', '502', '503')):
            raise self.retry(exc=exc, countdown=120 * (self.request.retries + 1))
