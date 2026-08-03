"""
Webhook signature validation (spec 8.2).

Carrier callbacks are the one unauthenticated write path into the system. They
carry no session, no API key and no user, and they mutate call state, trigger
suppressions and drive real money. Everything that protects them is here.

Three layers, in order of cost:

  1. IP allowlist        (middleware, before the view runs)
  2. Signature check     (this module)
  3. Correlation check   (the SID in the payload must match a call we placed)

Layer 3 matters more than it looks: a valid signature proves the request came
from the carrier, not that it refers to *our* call. Without the correlation
check, a genuine callback for a different account's call would be accepted.

The URL used for verification must be the URL the carrier signed, which is the
externally visible one. Behind a load balancer that terminates TLS, rebuilding
it from request.build_absolute_uri() yields http:// and the signature fails —
so it is rebuilt from PUBLIC_BASE_URL instead.
"""

from __future__ import annotations

import logging

from django.conf import settings

logger = logging.getLogger("ivr.webhook")


class SignatureError(Exception):
    pass


def signed_url(request) -> str:
    """The absolute URL as the carrier saw it, including the query string."""
    base = settings.PUBLIC_BASE_URL.rstrip("/")
    url = f"{base}{request.path}"
    query = request.META.get("QUERY_STRING", "")
    return f"{url}?{query}" if query else url


def verify(request, provider_name: str) -> bool:
    """Verify the provider signature on an inbound webhook request."""
    if not getattr(settings, "WEBHOOK_VERIFY_SIGNATURES", True):
        logger.warning("webhook signature verification is disabled")
        return True

    from apps.dialer.providers import get_provider

    try:
        provider = get_provider(provider_name)
    except ValueError:
        return False

    try:
        return bool(
            provider.verify_signature(
                url=signed_url(request),
                body=request.body,
                headers=request.headers,
            )
        )
    except Exception:  # noqa: BLE001 - a verifier that raises must not 500
        logger.exception("signature verification raised",
                         extra={"provider": provider_name})
        return False


def correlates(call, payload: dict) -> bool:
    """
    Confirm the payload actually describes the call we think it does.

    Called with the CallLog resolved from the `call` query parameter we put on
    our own callback URLs. If the SID in the body does not match, either the
    URL was tampered with or two callbacks crossed; in both cases the safe
    action is to fall back to SID lookup rather than mutating the wrong row.
    """
    if call is None:
        return False
    sid = payload.get("CallSid") or payload.get("call_sid") or ""
    if not sid:
        return False
    if call.provider_call_sid.startswith("pending:"):
        # The callback beat our own response to the originate request. That is
        # normal and the SID is exactly what we were waiting for.
        return True
    return call.provider_call_sid == sid
