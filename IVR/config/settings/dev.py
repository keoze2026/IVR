"""Local development settings."""

from config.settings.base import *  # noqa: F401,F403
from config.settings.base import env_bool

DEBUG = True
ALLOWED_HOSTS = ["*"]

# Spec 3.1: unscoped access to a tenant model raises in DEBUG.
TENANCY_STRICT = env_bool("TENANCY_STRICT", True)

# Run tasks inline when there is no worker around.
CELERY_TASK_ALWAYS_EAGER = env_bool("CELERY_TASK_ALWAYS_EAGER", False)
CELERY_TASK_EAGER_PROPAGATES = True

# Signature verification stays ON by default even in dev — turning it off is an
# explicit, noisy opt-in, because a dev habit of skipping it tends to survive
# into staging.
WEBHOOK_VERIFY_SIGNATURES = env_bool("WEBHOOK_VERIFY_SIGNATURES", True)

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
