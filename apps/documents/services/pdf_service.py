import os
import logging
import tempfile
import pdfplumber

logger = logging.getLogger(__name__)

MAX_PAGES = 100
MIN_TEXT_CHARS = 300
MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB


def validate_file(file_obj) -> None:
    if not file_obj.name.lower().endswith('.pdf'):
        raise ValueError('Apenas arquivos PDF são aceitos.')
    if file_obj.size > MAX_FILE_BYTES:
        mb = file_obj.size / (1024 * 1024)
        raise ValueError(f'Arquivo muito grande ({mb:.1f} MB). Máximo: 50 MB.')


def extract_text(file_obj) -> dict:
    """
    Extrai texto de um PDF em memória.
    Retorna dict com text, page_count, word_count.
    O arquivo temporário é removido ao final.
    """
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
        for chunk in file_obj.chunks():
            tmp.write(chunk)
        tmp_path = tmp.name

    try:
        with pdfplumber.open(tmp_path) as pdf:
            page_count = len(pdf.pages)

            if page_count > MAX_PAGES:
                raise ValueError(
                    f'PDF com {page_count} páginas excede o limite de {MAX_PAGES}.'
                )

            pages_text = []
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                if text and text.strip():
                    pages_text.append(f'--- Página {i + 1} ---\n{text.strip()}')

            full_text = '\n\n'.join(pages_text)

            if len(full_text) < MIN_TEXT_CHARS:
                raise ValueError(
                    'Não foi possível extrair texto suficiente. '
                    'O PDF pode ser uma imagem digitalizada sem texto selecionável. '
                    'Use um PDF com texto real.'
                )

            word_count = len(full_text.split())
            logger.info(
                f'PDF extraído: {page_count} páginas, {word_count} palavras '
                f'({len(full_text)} chars)'
            )
            return {'text': full_text, 'page_count': page_count, 'word_count': word_count}
    finally:
        os.unlink(tmp_path)
