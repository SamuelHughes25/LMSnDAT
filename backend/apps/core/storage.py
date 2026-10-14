from django.conf import settings
from django.core.files.storage import default_storage, storages


# Course images/thumbnails need stable, permanently-public URLs — the
# opposite of 'default' storage's private, 1-hour-signed URLs (see
# config/settings/base.py's AWS_QUERYSTRING_EXPIRE — deliberately kept
# that way for DB backups and learner-submitted attachment evidence,
# both of which should stay access-controlled, not public). Confirmed as
# a real, reported production bug: a presigned URL gets baked once into
# a slide's saved JSON config at upload time, and there's no way to
# "refresh" a value that's already permanently saved — so every pasted
# course image silently went blank (no error, just an expired link,
# rendering as the empty placeholder) exactly AWS_QUERYSTRING_EXPIRE
# seconds after it was uploaded.
#
# A callable, not a Storage instance directly, per Django's own
# recommendation for FileField(storage=...) — keeps this resolution
# environment-aware (local dev has no S3/expiry concept at all) without
# baking a config-dependent instance into migration files.
def public_media_storage():
    if settings.STORAGE_BACKEND == 's3':
        return storages['public']
    return default_storage
