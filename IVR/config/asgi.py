"""
ASGI entrypoint.

HTTP is served by the Django ASGI app; the websocket protocol is routed through
Channels with an authentication stack that resolves an Organization before the
consumer accepts (spec 1.1: tenant isolation).
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

# Must be built before importing anything that touches models.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402

from apps.telemetry.middleware import TokenAuthMiddlewareStack  # noqa: E402
from apps.telemetry.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AllowedHostsOriginValidator(
            TokenAuthMiddlewareStack(URLRouter(websocket_urlpatterns))
        ),
    }
)
