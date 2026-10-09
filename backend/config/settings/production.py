from .base import *  # noqa: F401,F403

DEBUG = False

# Django's various "force HTTPS" settings (SECURE_SSL_REDIRECT,
# SESSION_COOKIE_SECURE, CSRF_COOKIE_SECURE, SECURE_HSTS_*) are all written
# for the conventional case: Django itself terminates/sees real HTTPS
# traffic from browsers. That's NOT this architecture — Django is reachable
# ONLY over the internal Docker network (see docs/PROJECT_LOG.md's BFF
# decision): Next.js calls it server-to-server over plain HTTP
# (http://web:8000/...), and the one browser-facing surface, Django admin,
# is reached via an SSH tunnel (also plain HTTP at that point — the tunnel
# itself is what's encrypted). Caddy already terminates real TLS and
# redirects HTTP->HTTPS for the actual public domain (confirmed: Caddyfile's
# `{$DOMAIN} { reverse_proxy frontend:3000 }` gets Caddy's automatic HTTPS
# redirect for free), and Next.js's own session cookies already set
# `secure: true` in production (auth-cookies.ts) — so every one of these
# Django-level settings would be fighting traffic that was never HTTPS to
# begin with, not adding real protection on top of what Caddy/Next already
# provide. Confirmed the hard way on the first real deploy:
# SECURE_SSL_REDIRECT=True made Django 302-redirect every internal
# Next.js->Django API call to https://web:8000/..., which gunicorn can't
# serve at all (no TLS listener there), hanging every request for ~30s
# before failing outright — the live site was fully up but completely
# non-functional (couldn't log in, couldn't load anything) until this was
# found and reverted.
SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', default=False)
SESSION_COOKIE_SECURE = env.bool('SESSION_COOKIE_SECURE', default=False)
CSRF_COOKIE_SECURE = env.bool('CSRF_COOKIE_SECURE', default=False)

if STORAGE_BACKEND != 's3':
    raise RuntimeError('STORAGE_BACKEND must be "s3" in production.')
