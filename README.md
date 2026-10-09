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

## Production deploy

A single DigitalOcean Droplet running the whole stack via Docker Compose,
Caddy as the public reverse proxy with automatic HTTPS, Spaces for file
storage — see `lms-project-brief.md` for the full plan and reasoning.

**One-time setup on a fresh Droplet:**

```bash
git clone <your-private-repo-url> lms && cd lms
cp .env.example .env
# Edit .env: DJANGO_SECRET_KEY (generate a real one), DOMAIN, POSTGRES_PASSWORD
# (+ matching DATABASE_URL password), DJANGO_SETTINGS_MODULE=config.settings.production,
# DEBUG=False, STORAGE_BACKEND=s3 + real SPACES_* credentials, SENTRY_DSN (optional).
./deploy.sh
docker compose -f docker-compose.prod.yml exec web python manage.py createsuperuser
```

**Every deploy after that**, from the Droplet:

```bash
./deploy.sh
```

`deploy.sh` pulls the latest code, rebuilds and restarts every container, and
runs migrations. Unlike `docker-compose.yml` (dev — runs `next dev`/
`runserver`, bind-mounts source for hot reload, publishes every service's
port to the host), `docker-compose.prod.yml` builds real production images
(gunicorn + collectstatic behind whitenoise for Django,
`next build`'s standalone output for Next.js), and only Caddy is reachable
from outside the Droplet at all — Postgres, Redis, Django, and Next.js all
stay on the internal Docker network. See `Caddyfile` for the reverse proxy
config and `docs/PROJECT_LOG.md` for why Django itself never needs to be
public-facing.

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
