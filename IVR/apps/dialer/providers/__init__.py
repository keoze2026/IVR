"""
Provider adapters (spec 7.6).

Twilio and Telnyx are close enough that a common interface is honest rather
than aspirational — both originate calls over a REST call with the same
essential parameters and both drive the call with a TwiML-shaped document. The
adapter exists so that dual-carrier failover is a configuration change and not
a rewrite, and so that the dispatch task never imports a vendor SDK directly.
"""

from __future__ import annotations

import functools

from django.conf import settings

from apps.dialer.providers.base import (  # noqa: F401
    CallHandle,
    ProviderAdapter,
    ProviderCallError,
    ProviderRateLimited,
)


@functools.lru_cache(maxsize=4)
def get_provider(name: str | None = None) -> ProviderAdapter:
    key = (name or settings.DEFAULT_PROVIDER or "twilio").lower()
    if key == "twilio":
        from apps.dialer.providers.twilio import TwilioAdapter

        return TwilioAdapter()
    if key == "telnyx":
        from apps.dialer.providers.telnyx import TelnyxAdapter

        return TelnyxAdapter()
    raise ValueError(f"Unknown provider {key!r}")
