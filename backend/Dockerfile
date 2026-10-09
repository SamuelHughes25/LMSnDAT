FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements/ requirements/
ARG REQUIREMENTS_FILE=requirements/local.txt
RUN pip install --no-cache-dir -r ${REQUIREMENTS_FILE}

COPY . .
RUN chmod +x docker-entrypoint.sh

EXPOSE 8000

# Only takes effect when nothing overrides it — dev compose's `command:
# python manage.py runserver...` and the celery-worker/celery-beat services'
# own `command:` entries all override this already, so this only changes
# what happens in production (docker-compose.prod.yml's `web` service,
# which deliberately has no `command:` override).
CMD ["./docker-entrypoint.sh"]
