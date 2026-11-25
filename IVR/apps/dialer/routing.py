"""
Multi-Carrier Dynamic Routing & Failover Engine (spec 7.6).

Resolves carrier priority chains, intercepts carrier outages or 429 rate limits,
and automatically routes calls across Twilio and Telnyx without losing call state.
"""

from __future__ import annotations

import contextlib
import logging
from typing import TYPE_CHECKING

from django.conf import settings

from apps.dialer.circuit_breaker import circuit_breaker
from apps.dialer.providers import get_provider
from apps.dialer.providers.base import (
    CallHandle,
    OriginateRequest,
    ProviderAdapter,
    ProviderCallError,
    ProviderRateLimited,
)

if TYPE_CHECKING:
    from apps.campaigns.models import Campaign, CampaignContact
    from apps.contacts.models import Contact
    from apps.telephony.models import CallLog

logger = logging.getLogger("ivr.dialer")

#: Permanent recipient or validation errors where failover to another carrier
#: would only waste money and dial an unreachable/invalid number.
NON_FAILOVER_ERROR_CODES = {
    "13224",  # number not valid / not routable
    "13225",  # call blocked by carrier
    "21215",  # geo permission not enabled
    "21217",  # phone number not valid
    "21219",  # unverified trial number
    "21610",  # recipient opted out
}


def is_failover_eligible(exc: Exception) -> bool:
    """
    Determine if an originate exception is a carrier-side failure eligible
    for automatic failover to a backup carrier.
    """
    if isinstance(exc, ProviderRateLimited):
        return True

    if isinstance(exc, ProviderCallError):
        # Explicitly permanent recipient error
        if exc.code in NON_FAILOVER_ERROR_CODES:
            return False
        # Server errors (5xx) or explicitly retryable network/carrier errors
        server_err = exc.status >= 500 or exc.code in {"500", "502", "503", "504", "429"}
        if server_err or exc.retryable:
            return True

    # Generic request / connection timeouts
    err_str = str(exc).lower()
    terms = ("timeout", "connection refused", "503", "502", "504", "429")
    if any(term in err_str for term in terms):
        return True

    return getattr(exc, "retryable", False)


#: North American toll-free area codes.
_TOLL_FREE_NPAS = {"800", "833", "844", "855", "866", "877", "888"}

#: Carriers that cannot originate calls to toll-free destinations.
NO_TOLL_FREE_PROVIDERS = {"twilio"}


def is_toll_free(e164: str) -> bool:
    """True for +1 8xx toll-free numbers (NANP)."""
    return (
        len(e164) == 12 and e164.startswith("+1") and e164[2:5] in _TOLL_FREE_NPAS
    )


def resolve_carrier_chain(campaign: Campaign, to: str | None = None) -> list[str]:
    """
    Determine the ordered list of carrier providers to attempt.

    Ranks healthy/available carriers ahead of currently tripped carriers,
    ensuring calls are routed directly to active carriers during outages.
    Toll-free destinations are routed only to carriers that support them.
    """
    if to and is_toll_free(to):
        tf = (getattr(settings, "TOLL_FREE_PROVIDER", "telnyx") or "telnyx").lower()
        chain = [tf]
        for p in resolve_carrier_chain(campaign):
            if p not in chain and p not in NO_TOLL_FREE_PROVIDERS:
                chain.append(p)
        return chain

    primary = (campaign.effective_provider or settings.DEFAULT_PROVIDER or "twilio").lower()
    fallback = (getattr(settings, "FALLBACK_PROVIDER", "telnyx") or "telnyx").lower()

    if not getattr(settings, "ENABLE_CARRIER_FAILOVER", True):
        return [primary]

    # Build candidate list without duplicates
    chain: list[str] = [primary]
    if fallback != primary:
        chain.append(fallback)

    # Allow custom failover chain from settings
    configured_chain = getattr(settings, "CARRIER_FAILOVER_CHAIN", None)
    if configured_chain:
        for p in configured_chain:
            p_lower = p.lower()
            if p_lower not in chain:
                chain.append(p_lower)

    # Sort chain so that currently available carriers are tried before tripped ones
    # while preserving primary preference if multiple are healthy.
    def sort_key(provider_name: str) -> tuple[int, int]:
        available = circuit_breaker.is_available(provider_name)
        is_primary = provider_name == primary
        # priority: available (0 vs 1), is_primary (0 vs 1)
        return (0 if available else 1, 0 if is_primary else 1)

    return sorted(chain, key=sort_key)


def build_originate_request(
    provider_name: str,
    campaign: Campaign,
    contact: Contact,
    call: CallLog,
) -> OriginateRequest:
    """Build OriginateRequest with carrier-specific webhook URLs."""
    base_url = settings.PUBLIC_BASE_URL.rstrip("/")
    return OriginateRequest(
        to=contact.phone_e164,
        from_=campaign.caller_id.phone_e164,
        answer_url=f"{base_url}/webhooks/{provider_name}/ivr/entry/?call={call.pk}",
        status_callback_url=f"{base_url}/webhooks/{provider_name}/status/?call={call.pk}",
        ring_timeout=campaign.ring_timeout_seconds,
        amd_enabled=campaign.amd_enabled,
        amd_mode=campaign.amd_mode,
        amd_async=campaign.amd_async,
        amd_timeout=campaign.amd_timeout_seconds,
        amd_callback_url=f"{base_url}/webhooks/{provider_name}/amd/?call={call.pk}",
        record=campaign.record_calls,
        recording_callback_url=f"{base_url}/webhooks/{provider_name}/recording/?call={call.pk}",
        caller_name=campaign.caller_id.cnam_display,
    )


def originate_with_failover(
    campaign: Campaign,
    contact: Contact,
    call: CallLog,
    row: CampaignContact,
) -> tuple[CallHandle, str, ProviderAdapter]:
    """
    Attempt call origination through candidate carriers in priority order.

    If the primary carrier is degraded or fails with a retryable error,
    transparently switches to the fallback carrier in real time.
    """
    from apps.telephony.models import CallLog

    chain = resolve_carrier_chain(campaign, contact.phone_e164)
    last_exc: Exception | None = None

    for idx, provider_name in enumerate(chain):
        provider = get_provider(provider_name)
        request = build_originate_request(provider_name, campaign, contact, call)

        # Update CallLog provider before dialling so callbacks attach cleanly
        with contextlib.suppress(Exception):
            CallLog.objects.unscoped().filter(pk=call.pk).update(provider=provider_name)

        if hasattr(call, "provider"):
            call.provider = provider_name

        try:
            handle = provider.place_call(request)
            circuit_breaker.record_success(provider_name)

            if idx > 0:
                # Successfully failed over!
                logger.info(
                    "call successfully failed over to backup carrier",
                    extra={
                        "primary_provider": chain[0],
                        "active_provider": provider_name,
                        "campaign": str(campaign.pk),
                        "sid": handle.sid,
                    },
                )
                circuit_breaker.record_failover(chain[0], provider_name)

            return handle, provider_name, provider

        except Exception as exc:
            last_exc = exc
            is_rate_limit = isinstance(exc, ProviderRateLimited)
            retry_after = getattr(exc, "retry_after", 60.0) if is_rate_limit else 0.0
            is_outage = getattr(exc, "status", 0) >= 500

            circuit_breaker.record_failure(
                provider_name,
                exc,
                is_rate_limit=is_rate_limit,
                retry_after=retry_after,
                is_server_outage=is_outage,
            )

            has_fallback = idx + 1 < len(chain)
            eligible = is_failover_eligible(exc)

            if has_fallback and eligible:
                next_provider = chain[idx + 1]
                logger.warning(
                    "carrier originate failed, failing over to next carrier",
                    extra={
                        "failed_provider": provider_name,
                        "next_provider": next_provider,
                        "campaign": str(campaign.pk),
                        "error": str(exc),
                    },
                )
                continue
            # No more candidates or error is permanent recipient error
            raise exc

    # Should not reach here, but if so, raise the last exception
    if last_exc:
        raise last_exc
    raise ProviderCallError("No telephony carriers available for dispatch")
