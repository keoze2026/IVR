"""Small shared helpers."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

from django.conf import settings


def phone_hash(e164: str) -> str:
    """SHA-256(pepper || E.164).

    Suppression matching, cross-tenant global DNC checks and erasure
    verification all run on this value, so those paths never read the
    plaintext column (spec 4.8). Changing the pepper orphans every stored
    hash — treat it as permanent.
    """
    return hashlib.sha256(
        (settings.PHONE_HASH_PEPPER + e164).encode("utf-8")
    ).hexdigest()


def stable_checksum(document) -> str:
    """Order-independent checksum of a JSON document.

    Used to detect whether a flow version's definition actually changed, so
    re-saving an unmodified flow does not force a re-render of every prompt.
    """
    canonical = json.dumps(document, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def utcnow() -> datetime:
    return datetime.now(UTC)


def chunked(iterable, size: int):
    """Yield lists of at most `size` items from any iterable."""
    batch = []
    for item in iterable:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def mask_phone(e164: str) -> str:
    """For display in logs, exports and UI where full numbers aren't needed."""
    if not e164:
        return ""
    return f"{e164[:2]}{'*' * max(0, len(e164) - 6)}{e164[-4:]}"
