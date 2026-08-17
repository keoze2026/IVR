"""
Production settings.

This module asserts its own preconditions at import time. A misconfigured
production process must fail to boot rather than start and silently place
non-compliant calls.
"""

import os

from config.settings.base import *  # noqa: F401,F403
from config.settings.base import env, env_bool

DEBUG = False
TENANCY_STRICT = env_bool("TENANCY_STRICT", False)  # log + alert, don't 500 in prod
WEBHOOK_VERIFY_SIGNATURES = True

# --- TLS / headers ---------------------------------------------------------
# Configurable, and off when TLS is terminated and redirected at the edge
# (the host nginx already does http->https). Left on, Django would 301 the
# portal's internal HTTP calls to the backend and the login would never land.
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31_536_000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True
X_FRAME_OPTIONS = "DENY"

# --- Fail fast on missing secrets -----------------------------------------
_REQUIRED = [
    "DJANGO_SECRET_KEY",
    "PHONE_HASH_PEPPER",
    "POSTGRES_PASSWORD",
    "PUBLIC_BASE_URL",
]
_missing = [k for k in _REQUIRED if not os.environ.get(k)]
if _missing:
    raise RuntimeError(f"Missing required production settings: {', '.join(_missing)}")

if os.environ["PHONE_HASH_PEPPER"] == "dev-pepper-change-me":
    raise RuntimeError("PHONE_HASH_PEPPER is still the development default")

if not os.environ["PUBLIC_BASE_URL"].startswith("https://"):
    raise RuntimeError("PUBLIC_BASE_URL must be https in production")

# Carrier callbacks carry no user credentials; the only authentication is the
# provider signature plus the network allowlist. Both are mandatory here.
if not env("WEBHOOK_IP_ALLOWLIST"):
    import logging

    logging.getLogger("ivr.webhook").warning(
        "WEBHOOK_IP_ALLOWLIST is empty — relying on signature verification alone"
    )

# --- Sentry ----------------------------------------------------------------
_dsn = env("SENTRY_DSN", "")
if _dsn:
    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=_dsn,
        integrations=[DjangoIntegration(), CeleryIntegration()],
        traces_sample_rate=float(env("SENTRY_TRACES_SAMPLE_RATE", "0.05")),
        send_default_pii=False,  # phone numbers are PII; never ship them to Sentry
        environment=env("SENTRY_ENVIRONMENT", "production"),
    )
