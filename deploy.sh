#!/bin/bash
# Run this ON the Droplet, from the repo root, after SSHing in — deliberately
# a short, manual script (not a CI/CD pipeline), per the project brief.
#
#   ssh you@your-droplet-ip
#   cd lms   # wherever you cloned the repo
#   ./deploy.sh
set -euo pipefail

echo "==> Pulling latest code"
git pull

echo "==> Building and starting containers"
docker compose -f docker-compose.prod.yml up --build -d

echo "==> Running migrations"
docker compose -f docker-compose.prod.yml exec -T web python manage.py migrate --noinput

echo "==> Done. Recent logs:"
docker compose -f docker-compose.prod.yml logs --tail=20 web frontend caddy
