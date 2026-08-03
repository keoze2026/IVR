"""
Network-level protection for the webhook surface (spec 12.4).

The allowlist is a defence in depth, not the primary control — signatures are.
It exists because it is cheap, it stops scanners before they reach any Django
view, and it bounds the blast radius if an auth token ever leaks.

Carrier IP ranges change. This reads from configuration rather than hardcoding
them, and an empty allowlist disables the check (with a warning at boot in
production) so that a stale range cannot take the whole webhook path down.
"""

from __future__ import annotations

import ipaddress
import logging

from django.conf import settings
from django.http import HttpResponseForbidden

logger = logging.getLogger("ivr.webhook")


class WebhookIPAllowlistMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.networks = []
        for cidr in getattr(settings, "WEBHOOK_IP_ALLOWLIST", []) or []:
            try:
                self.networks.append(ipaddress.ip_network(cidr, strict=False))
            except ValueError:
                logger.error("invalid CIDR in WEBHOOK_IP_ALLOWLIST",
                             extra={"cidr": cidr})

    def __call__(self, request):
        if (self.networks and request.path.startswith("/webhooks/")
                and not self._allowed(request)):
            logger.warning(
                "webhook rejected by IP allowlist",
                extra={"ip": self._client_ip(request), "path": request.path},
            )
            return HttpResponseForbidden("Source address not permitted.")
        return self.get_response(request)

    def _allowed(self, request) -> bool:
        raw = self._client_ip(request)
        try:
            address = ipaddress.ip_address(raw)
        except ValueError:
            return False
        return any(address in network for network in self.networks)

    @staticmethod
    def _client_ip(request) -> str:
        # The left-most entry is the client as seen by the first proxy. Trusting
        # it requires that the edge overwrites rather than appends — nginx.conf
        # in deploy/ is configured that way.
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "")
