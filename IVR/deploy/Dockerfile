# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# One image, many process types. The command decides whether a container is a
# web server, a pacer, a dispatcher or beat — see docker-compose.yml. Building
# separate images per role would mean four things to keep in version lockstep
# for no isolation benefit.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Non-root. The application never needs to write to its own code directory.
RUN useradd --system --uid 10001 --home /app ivr \
    && mkdir -p /app/staticfiles \
    && chown -R ivr:ivr /app
USER ivr

RUN DJANGO_SETTINGS_MODULE=config.settings.base \
    DJANGO_SECRET_KEY=build-only \
    python manage.py collectstatic --noinput || true

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/healthz || exit 1

ENTRYPOINT ["/app/deploy/entrypoint.sh"]
CMD ["web"]
