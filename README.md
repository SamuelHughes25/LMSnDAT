# LMS / Audit Template Platform

Internal replacement for Mitti/SafetyCulture, focused on a feature-rich template builder. See [lms-project-brief.md](lms-project-brief.md) for the full brief and [docs/PROJECT_LOG.md](docs/PROJECT_LOG.md) for architecture decisions and the running features log.

## Stack

- **Backend**: Django + Django REST Framework, PostgreSQL (JSONB for question config/answers), Celery + Redis + Celery Beat for recurrence/reminders.
- **Frontend**: Next.js (App Router), built as a BFF — not scaffolded yet, backend contracts come first.
- **Storage**: swappable via `STORAGE_BACKEND` env var — local filesystem for dev, S3-compatible (DigitalOcean Spaces) for production.

## Local development

Requires Docker Desktop.

```bash
cp .env.example .env
docker compose up --build
```

Then, in another terminal:

```bash
docker compose exec web python manage.py migrate
docker compose exec web python manage.py createsuperuser
```

- API: http://localhost:8000/api/v1/
- Admin: http://localhost:8000/admin/

## Running tests

```bash
docker compose exec web python manage.py test
```

## Project layout

```
backend/
├── config/            # settings, urls, celery app
├── apps/
│   ├── core/           # shared base model, permissions, pagination
│   ├── accounts/        # User (custom, role-based), Team
│   ├── templates_app/    # Template, TemplateVersion, Section, Question — the builder's data model
│   ├── assignments/      # Assignment, RRULE-based recurrence, Celery Beat tasks
│   ├── submissions/      # Submission, Answer, Attachment
│   └── corrective_actions/
docker-compose.yml
docs/PROJECT_LOG.md   # architecture decisions + features log
```

Each app owns its own `models.py` / `serializers.py` / `views.py` / `urls.py`. If one grows past ~300-400 lines it gets split rather than left to sprawl.
