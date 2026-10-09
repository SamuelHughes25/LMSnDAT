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

# No separate `migrate` step here — docker-entrypoint.sh already runs
# migrate (then collectstatic, then gunicorn) every time the `web`
# container starts, including this one. A second explicit migrate call
# right after `up -d` used to race that same in-progress migration and
# fail with a duplicate-key error on whichever table it collided with
# mid-creation — a false alarm (the real deploy had already succeeded by
# the time it printed), confirmed on the very first production deploy.
# Waiting for `web`'s own healthcheck (hits /healthz/, which only
# responds once gunicorn is actually serving — i.e. after migrate and
# collectstatic both finished) is both correct and sufficient.
echo "==> Waiting for web to become healthy"
for _ in $(seq 1 30); do
  status=$(docker compose -f docker-compose.prod.yml ps --format json web | python3 -c "import json,sys; print(json.load(sys.stdin).get('Health',''))" 2>/dev/null || echo "")
  [ "$status" = "healthy" ] && break
  sleep 2
done

echo "==> Done. Recent logs:"
docker compose -f docker-compose.prod.yml logs --tail=20 web frontend caddy
