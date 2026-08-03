"""
Idempotent event ingestion (spec 8.5).

CPaaS providers retry and occasionally reorder callbacks. Both happen in
normal operation, not just under failure: a retry follows any response the
carrier considers slow, and reordering follows from the callbacks being
independent HTTP requests racing each other.

Three mechanisms, because no one of them is sufficient:

  Redis SETNX dedupe key
      Catches literal duplicates — the same callback delivered twice. Cheap,
      in the request path, 24-hour TTL.

  Unique constraint on (sid, event_type, sequence_number)
      Catches duplicates that slipped past the cache (Redis restart, TTL
      expiry on a very late retry). The database is the backstop.

  Monotonic status rank
      Catches *reordering*. A `ringing` callback arriving after `completed`
      must not move the call backwards. The raw event is still recorded — it
      is evidence — but it does not mutate CallLog.status.

Nothing here writes to Postgres; this runs in the webhook request path. It
dedupes, then hands off to the events queue.
"""

from __future__ import annotations

import logging

from redis.exceptions import RedisError

from apps.common.redis_clients import Keys, counters_redis

logger = logging.getLogger("ivr.webhook")

DEDUPE_TTL = 86_400


def already_seen(sid: str, event_type: str, sequence) -> bool:
    """
    True if this exact callback has been processed before.

    Fails *open* on a Redis error: the database constraint and the monotonic
    rank check both still apply downstream, so processing a duplicate is
    recoverable, whereas dropping a `completed` callback leaks a channel and
    strands a queue row.
    """
    key = Keys.dedupe(sid, event_type, sequence if sequence is not None else "-")
    try:
        return not counters_redis().set(key, "1", nx=True, ex=DEDUPE_TTL)
    except RedisError:
        logger.exception("dedupe check failed; processing anyway", extra={"sid": sid})
        return False


def ingest_status_callback(provider_name: str, sid: str, payload: dict) -> bool:
    """
    Accept one status callback. Returns False if it was a duplicate.

    Called from the webhook view, so it must stay allocation-light and do no
    database work.
    """
    status = (payload.get("CallStatus") or payload.get("status") or "").lower()
    sequence = payload.get("SequenceNumber")

    if already_seen(sid, f"status:{status}", sequence):
        logger.debug("duplicate status callback ignored",
                     extra={"sid": sid, "status": status})
        return False

    from apps.telephony.tasks import apply_status_callback

    apply_status_callback.delay(provider_name, sid, dict(payload))
    return True


def is_forward_transition(current: str, incoming: str) -> bool:
    """
    Whether `incoming` is allowed to overwrite `current`.

    Equal ranks are allowed through (a `busy` after a `failed` is a
    re-classification of the same terminal outcome, and the later carrier
    verdict is the better one). Anything strictly backwards is not.
    """
    from apps.common.enums import CALL_STATUS_RANK

    if not current:
        return True
    return CALL_STATUS_RANK.get(incoming, 0) >= CALL_STATUS_RANK.get(current, 0)


def normalise_payload(provider_name: str, payload: dict) -> dict:
    """
    Flatten a provider payload into the fields CallLog cares about.

    Twilio and Telnyx use the same TwiML-era field names on the TeXML surface,
    which is why one normaliser covers both; anything provider-specific is
    resolved through the adapter rather than by branching here.
    """
    from apps.dialer.providers import get_provider

    provider = get_provider(provider_name)
    status = payload.get("CallStatus") or payload.get("status") or ""

    out = {
        "status": provider.normalise_status(status),
        "sequence": _int_or_none(payload.get("SequenceNumber")),
        "duration_seconds": _int(payload.get("CallDuration") or payload.get("Duration")),
        "billable_seconds": _int(payload.get("CallDuration")),
        "sip_response_code": _int_or_none(payload.get("SipResponseCode")),
        "error_code": str(payload.get("ErrorCode") or "")[:16],
        "error_message": str(payload.get("ErrorMessage") or "")[:500],
        "parent_call_sid": payload.get("ParentCallSid", "") or "",
        "cost": _decimal_or_none(payload.get("Price")),
        "cost_currency": (payload.get("PriceUnit") or "USD")[:3],
        "stir_attestation": (payload.get("StirVerstat") or "")[:1],
    }
    if payload.get("AnsweredBy"):
        out["answered_by"] = provider.normalise_answered_by(payload["AnsweredBy"])
    return out


def _int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _int_or_none(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _decimal_or_none(value):
    from decimal import Decimal, InvalidOperation

    if value in (None, ""):
        return None
    try:
        # Twilio reports price as a negative string ("-0.01300") because it is
        # a debit. Stored as a positive cost; the sign is not information.
        return abs(Decimal(str(value)))
    except (InvalidOperation, ValueError):
        return None
