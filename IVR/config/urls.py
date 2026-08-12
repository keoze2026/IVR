"""
Root URL configuration.

Two distinct surfaces with different threat models:

  /api/v1/    operator API   — authenticated, CSRF-protected, throttled
  /webhooks/  carrier ingress — unauthenticated in the session sense, CSRF
              exempt, protected by provider signature + IP allowlist only

They are deliberately kept on separate prefixes so the edge can apply different
WAF rules to each.
"""

from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def healthz(_request):
    return JsonResponse({"status": "ok"})


def readyz(_request):
    """Readiness: can we reach Postgres and Redis right now?"""
    from django.db import connection
    from django_redis import get_redis_connection

    checks = {}
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
        checks["postgres"] = "ok"
    except Exception as exc:  # pragma: no cover
        checks["postgres"] = f"error: {exc.__class__.__name__}"
    try:
        get_redis_connection("default").ping()
        checks["redis"] = "ok"
    except Exception as exc:  # pragma: no cover
        checks["redis"] = f"error: {exc.__class__.__name__}"

    ok = all(v == "ok" for v in checks.values())
    return JsonResponse({"status": "ok" if ok else "degraded", "checks": checks},
                        status=200 if ok else 503)


urlpatterns = [
    # Django admin is deliberately absent. It is a developer's tool — it
    # exposes column names, cascades and every model without regard to
    # tenancy — and this platform is administered from the portal instead.
    # See apps/accounts/platform.py.
    path("healthz", healthz),
    path("readyz", readyz),
    path("api/v1/", include(("apps.common.urls", "api"), namespace="v1")),
    path("webhooks/", include("apps.telephony.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
]
