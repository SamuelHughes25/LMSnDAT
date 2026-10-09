from .base import *  # noqa: F401,F403

DEBUG = False

SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', default=True)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
# Off by default — submitting to the browser HSTS preload list is a much
# stickier commitment than the HSTS header alone (removal can take months
# to propagate once a domain's in browsers' baked-in lists), not something
# to flip on by default before the domain's even live. `manage.py check
# --deploy`'s only remaining warning without this; a deliberate, opt-in
# choice to leave it, not an oversight.
SECURE_HSTS_PRELOAD = env.bool('SECURE_HSTS_PRELOAD', default=False)

if STORAGE_BACKEND != 's3':
    raise RuntimeError('STORAGE_BACKEND must be "s3" in production.')
