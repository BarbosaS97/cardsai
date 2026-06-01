.PHONY: help run migrate shell celery logs status superuser collectstatic

VENV=venv/bin
PYTHON=$(VENV)/python
MANAGE=$(PYTHON) manage.py

help:
	@echo "Comandos disponíveis:"
	@echo "  make run          - Iniciar servidor de desenvolvimento"
	@echo "  make migrate      - Criar e aplicar migrações"
	@echo "  make shell        - Abrir shell Django"
	@echo "  make celery       - Iniciar worker Celery"
	@echo "  make logs         - Ver logs da aplicação"
	@echo "  make status       - Status dos serviços"
	@echo "  make superuser    - Criar superusuário"
	@echo "  make collectstatic - Coletar arquivos estáticos"

run:
	$(MANAGE) runserver 0.0.0.0:8000

migrate:
	$(MANAGE) makemigrations
	$(MANAGE) migrate

shell:
	$(MANAGE) shell

celery:
	$(VENV)/celery -A cardsai worker -l info --concurrency=2

celery-beat:
	$(VENV)/celery -A cardsai beat -l info

logs:
	tail -f logs/django.log

status:
	@echo "=== Redis ===" && redis-cli ping
	@echo "=== Nginx ===" && systemctl is-active nginx
	@echo "=== Supervisor ===" && supervisorctl status

superuser:
	$(MANAGE) createsuperuser

collectstatic:
	$(MANAGE) collectstatic --noinput

check:
	$(MANAGE) check --deploy
