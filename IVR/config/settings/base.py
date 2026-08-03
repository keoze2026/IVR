"""
Base settings shared by every environment.

Environment-specific modules (dev.py, prod.py) import * from here and override.
Nothing in this file may read a secret without a default that is safe to run in
CI; production hardening lives in prod.py and is asserted there.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


# --------------------------------------------------------------------------
# Tiny env helper. Deliberately dependency-free so settings import cheaply in
# the Celery worker bootstrap path.
# --------------------------------------------------------------------------
def env(key: str, default=None, *, required: bool = False) -> str | None:
    val = os.environ.get(key, default)
    if required and not val:
        raise RuntimeError(f"Required environment variable {key} is unset")
    return val


def env_bool(key: str, default: bool = False) -> bool:
    return str(os.environ.get(key, default)).strip().lower() in {"1", "true", "yes", "on"}


def env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


def env_list(key: str, default: str = "") -> list[str]:
    raw = os.environ.get(key, default) or ""
    return [item.strip() for item in raw.split(",") if item.strip()]


# --------------------------------------------------------------------------
# Core
# --------------------------------------------------------------------------
SECRET_KEY = env("DJANGO_SECRET_KEY", "insecure-dev-key-do-not-use-in-production")
DEBUG = False
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    # third party
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "django_celery_beat",
    "channels",
    # local
    "apps.common",
    "apps.accounts",
    "apps.contacts",
    "apps.compliance",
    "apps.ivr",
    "apps.campaigns",
    "apps.dialer",
    "apps.telephony",
    "apps.telemetry",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.telephony.middleware.WebhookIPAllowlistMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"
AUTH_USER_MODEL = "accounts.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"


# --------------------------------------------------------------------------
# Database
#
# CONN_MAX_AGE must be 0 when pgbouncer runs in transaction pooling mode:
# Django's persistent connections and pgbouncer's transaction multiplexing
# fight over the same server-side session state.
# --------------------------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "ivr"),
        "USER": env("POSTGRES_USER", "ivr"),
        "PASSWORD": env("POSTGRES_PASSWORD", "ivr"),
        "HOST": env("POSTGRES_HOST", "127.0.0.1"),
        "PORT": env("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": env_int("DB_CONN_MAX_AGE", 0),
        "OPTIONS": {
            # Never let a runaway query hold a dispatch worker hostage.
            "options": "-c statement_timeout=15000",
        },
    }
}


# --------------------------------------------------------------------------
# Redis — logical DB separation per spec 3
#   db0 broker | db1 cache | db2 call state | db3 channels | db4 counters
# --------------------------------------------------------------------------
REDIS_URL = env("REDIS_URL", "redis://127.0.0.1:6379").rstrip("/")
REDIS_DB_BROKER = env_int("REDIS_DB_BROKER", 0)
REDIS_DB_CACHE = env_int("REDIS_DB_CACHE", 1)
REDIS_DB_CALLSTATE = env_int("REDIS_DB_CALLSTATE", 2)
REDIS_DB_CHANNELS = env_int("REDIS_DB_CHANNELS", 3)
REDIS_DB_COUNTERS = env_int("REDIS_DB_COUNTERS", 4)


def redis_dsn(db: int) -> str:
    return f"{REDIS_URL}/{db}"


CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": redis_dsn(REDIS_DB_CACHE),
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
        "KEY_PREFIX": "ivr",
    },
    # Suppression-gate cache. Separate alias so a cache flush of `default`
    # (routine) can never widen the dialable set (catastrophic).
    "dnc": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": redis_dsn(REDIS_DB_CACHE),
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
        "KEY_PREFIX": "dnc",
        "TIMEOUT": 300,
    },
}

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [redis_dsn(REDIS_DB_CHANNELS)],
            "capacity": 2000,
            "expiry": 30,
        },
    }
}


# --------------------------------------------------------------------------
# Celery
# --------------------------------------------------------------------------
CELERY_BROKER_URL = redis_dsn(REDIS_DB_BROKER)
CELERY_RESULT_BACKEND = None  # fire-and-forget; results are in Postgres
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TIMEZONE = "UTC"
CELERY_ENABLE_UTC = True
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_BROKER_TRANSPORT_OPTIONS = {"visibility_timeout": 3600}
CELERY_TASK_DEFAULT_QUEUE = "maintenance"


# --------------------------------------------------------------------------
# DRF
# --------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.APIKeyAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "apps.accounts.permissions.IsOrganizationMember",
    ],
    "DEFAULT_PAGINATION_CLASS": "apps.common.pagination.CursorPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "apps.common.throttling.OrganizationRateThrottle",
        "apps.common.throttling.BurstRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "org": "600/min",
        "burst": "60/sec",
        "upload": "20/hour",
        "campaign_control": "60/min",
    },
    "EXCEPTION_HANDLER": "apps.common.exceptions.api_exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_VERSIONING_CLASS": "rest_framework.versioning.URLPathVersioning",
    "DEFAULT_VERSION": "v1",
    "ALLOWED_VERSIONS": ["v1"],
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Outbound IVR Platform API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": "/api/v1",
}


# --------------------------------------------------------------------------
# Compliance
# --------------------------------------------------------------------------
# Peppers every phone hash. Rotating it orphans every stored phone_hash and
# therefore every suppression record — it is effectively permanent.
PHONE_HASH_PEPPER = env("PHONE_HASH_PEPPER", "dev-pepper-change-me")
DEFAULT_REGION = env("DEFAULT_REGION", "US")

# Federal ceiling for US traffic. CallingWindow rows may tighten these per
# jurisdiction; the resolver never widens beyond them (spec 7.4).
US_FEDERAL_WINDOW_START = "08:00"
US_FEDERAL_WINDOW_END = "21:00"

# Raise on an unscoped tenant queryset instead of logging. Defaults to DEBUG.
TENANCY_STRICT = env_bool("TENANCY_STRICT", False)

# Live call state TTL in Redis (spec 2.3: 4 hours).
CALL_STATE_TTL_SECONDS = env_int("CALL_STATE_TTL_SECONDS", 4 * 3600)

# Webhook replay window. Signatures older than this are rejected outright.
WEBHOOK_MAX_SKEW_SECONDS = env_int("WEBHOOK_MAX_SKEW_SECONDS", 300)
WEBHOOK_IP_ALLOWLIST = env_list("WEBHOOK_IP_ALLOWLIST")

# Retention (spec 4.7 / 12.5).
CALL_EVENT_RETENTION_DAYS = env_int("CALL_EVENT_RETENTION_DAYS", 90)
RECORDING_RETENTION_DAYS = env_int("RECORDING_RETENTION_DAYS", 365)


# --------------------------------------------------------------------------
# Telephony providers
# --------------------------------------------------------------------------
PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
DEFAULT_PROVIDER = env("DEFAULT_PROVIDER", "twilio")

TWILIO_ACCOUNT_SID = env("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = env("TWILIO_AUTH_TOKEN", "")
TWILIO_API_KEY_SID = env("TWILIO_API_KEY_SID", "")
TWILIO_API_KEY_SECRET = env("TWILIO_API_KEY_SECRET", "")

TELNYX_API_KEY = env("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = env("TELNYX_PUBLIC_KEY", "")
TELNYX_CONNECTION_ID = env("TELNYX_CONNECTION_ID", "")

# Hard ceiling applied on top of any per-campaign cps_limit. Protects the
# carrier account from a misconfigured campaign.
GLOBAL_CPS_CEILING = float(env("GLOBAL_CPS_CEILING", "50"))
GLOBAL_CHANNEL_CEILING = env_int("GLOBAL_CHANNEL_CEILING", 500)


# --------------------------------------------------------------------------
# Object storage
# --------------------------------------------------------------------------
AWS_ACCESS_KEY_ID = env("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = env("AWS_SECRET_ACCESS_KEY", "")
AWS_S3_REGION_NAME = env("AWS_S3_REGION_NAME", "us-east-1")
AWS_S3_ENDPOINT_URL = env("AWS_S3_ENDPOINT_URL", "") or None
S3_BUCKET_UPLOADS = env("S3_BUCKET_UPLOADS", "ivr-uploads")
S3_BUCKET_PROMPTS = env("S3_BUCKET_PROMPTS", "ivr-prompts")
S3_BUCKET_RECORDINGS = env("S3_BUCKET_RECORDINGS", "ivr-recordings")
SIGNED_URL_TTL_SECONDS = env_int("SIGNED_URL_TTL_SECONDS", 900)

TTS_PROVIDER = env("TTS_PROVIDER", "polly")
POLLY_VOICE_ID = env("POLLY_VOICE_ID", "Joanna")
POLLY_ENGINE = env("POLLY_ENGINE", "neural")
ELEVENLABS_API_KEY = env("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = env("ELEVENLABS_VOICE_ID", "")


# --------------------------------------------------------------------------
# Logging
# --------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": "apps.common.logging.JSONFormatter",
        },
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "json"},
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
    "loggers": {
        "django.db.backends": {"level": "WARNING", "propagate": True},
        # Tenancy violations are a data-breach class defect (spec 1.1).
        "ivr.tenancy": {"level": "WARNING", "propagate": True},
        "ivr.dialer": {"level": "INFO", "propagate": True},
        "ivr.webhook": {"level": "INFO", "propagate": True},
        "ivr.compliance": {"level": "INFO", "propagate": True},
    },
}
