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


def acting_user(request):
    """The `User` row behind a request, or None if there is not one.

    An API-key request carries an `APIKeyUser`, which duck-types the user
    contract — including `is_authenticated`, which is unconditionally True.
    So the obvious `request.user if request.user.is_authenticated else None`
    passes and then raises ValueError the moment the result is assigned to a
    `User` foreign key. Machine credentials are the normal way this API is
    driven, so that turned routine writes into 500s.

    Attribution for key-authenticated requests lives on the API key itself
    (`AuditLogEntry.api_key`, and `request.api_key` for anything else that
    needs it), not on these columns.
    """
    from apps.accounts.models import User

    user = getattr(request, "user", None)
    if isinstance(user, User) and user.is_authenticated:
        return user
    return None
