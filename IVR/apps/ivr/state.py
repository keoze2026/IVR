"""
Live call state in Redis (spec 6.5).

IVR traversal is a read-modify-write on every keypress with a sub-second budget
(the carrier wants TwiML back in a couple of seconds, and a slow response is
audible as dead air). Postgres is the durable record; Redis is the working set.

The hash at ``call_state:{sid}`` is written when the call is placed, mutated by
each webhook, and reconciled into CallLog when the call completes. It carries a
4-hour TTL: long enough to outlive any real call, short enough that a leaked
key is not a permanent PII store.

Everything in here is reconstructable. If Redis loses the key mid-call the
webhook falls back to the flow's entry node and logs a state-loss event rather
than dropping the call — a caller hearing the greeting twice is a bad
experience; a caller hearing silence is a hangup and a wasted dial.
"""

from __future__ import annotations

import json
import logging

from django.conf import settings

from apps.common.redis_clients import Keys, callstate_redis

logger = logging.getLogger("ivr.webhook")

# Fields stored as JSON inside the hash rather than as flat keys.
#
# `merge` holds the contact's merge context, snapshotted at dial time. It lives
# here rather than being re-read from Postgres on every keypress: the contact
# row cannot change mid-call, and a query in the webhook path would spend the
# latency budget on data we already had.
_JSON_FIELDS = {"path", "vars", "node_attempts", "merge"}


class CallState:
    """Thin typed wrapper over the Redis hash. Not a model; do not persist it."""

    __slots__ = ("sid", "data", "_dirty")

    def __init__(self, sid: str, data: dict | None = None):
        self.sid = sid
        self.data = data or {}
        self._dirty = set()

    # --- accessors -----------------------------------------------------
    @property
    def campaign_id(self) -> str:
        return self.data.get("campaign_id", "")

    @property
    def organization_id(self) -> str:
        return self.data.get("organization_id", "")

    @property
    def contact_id(self) -> str:
        return self.data.get("contact_id", "")

    @property
    def flow_version_id(self) -> str:
        return self.data.get("flow_version_id", "")

    @property
    def node(self) -> str:
        return self.data.get("node", "")

    @property
    def path(self) -> list[str]:
        return self.data.get("path", [])

    @property
    def vars(self) -> dict:
        return self.data.get("vars", {})

    @property
    def merge(self) -> dict:
        return self.data.get("merge", {})

    @property
    def to_number(self) -> str:
        return self.data.get("to_number", "")

    @property
    def answered_by(self) -> str:
        return self.data.get("answered_by", "")

    @property
    def disposition(self) -> str:
        return self.data.get("disposition", "")

    def attempts_at(self, node_id: str) -> int:
        return int(self.data.get("node_attempts", {}).get(node_id, 0))

    # --- mutators ------------------------------------------------------
    def set(self, **fields):
        self.data.update(fields)
        self._dirty.update(fields)
        return self

    def enter_node(self, node_id: str):
        path = list(self.path)
        # Repeated visits to the same node (a retried menu) are not appended
        # twice; the attempt counter carries that information.
        if not path or path[-1] != node_id:
            path.append(node_id)
        self.set(node=node_id, path=path[-64:])
        return self

    def bump_attempt(self, node_id: str) -> int:
        attempts = dict(self.data.get("node_attempts", {}))
        attempts[node_id] = attempts.get(node_id, 0) + 1
        self.set(node_attempts=attempts)
        return attempts[node_id]

    def set_var(self, name: str, value):
        merged = dict(self.vars)
        merged[name] = value
        self.set(vars=merged)
        return self

    def set_disposition(self, disposition: str):
        # First meaningful disposition wins: a caller who pressed 1 and then
        # hung up during the confirmation is "confirmed", not "abandoned".
        if not self.data.get("disposition"):
            self.set(disposition=disposition)
        return self

    # --- persistence ---------------------------------------------------
    def save(self, ttl: int | None = None):
        if not self._dirty:
            return self
        payload = {
            key: json.dumps(self.data[key]) if key in _JSON_FIELDS
            else str(self.data[key])
            for key in self._dirty
            if self.data.get(key) is not None
        }
        if not payload:
            # Every dirty field was None. HSET with an empty mapping is an
            # error, and there is nothing to write anyway.
            self._dirty.clear()
            return self
        client = callstate_redis()
        pipe = client.pipeline()
        pipe.hset(Keys.call_state(self.sid), mapping=payload)
        pipe.expire(Keys.call_state(self.sid),
                    ttl or settings.CALL_STATE_TTL_SECONDS)
        pipe.execute()
        self._dirty.clear()
        return self


def create(sid: str, **fields) -> CallState:
    state = CallState(sid)
    state.set(path=[], vars={}, node_attempts={}, **fields)
    return state.save()


def load(sid: str) -> CallState | None:
    raw = callstate_redis().hgetall(Keys.call_state(sid))
    if not raw:
        return None
    data = {}
    for key, value in raw.items():
        if key in _JSON_FIELDS:
            try:
                data[key] = json.loads(value)
            except (TypeError, ValueError):
                data[key] = [] if key == "path" else {}
        else:
            data[key] = value
    return CallState(sid, data)


def load_or_rebuild(sid: str) -> CallState | None:
    """
    Fetch live state, rebuilding from Postgres if Redis lost it.

    The rebuild is deliberately minimal — enough to keep the call moving from
    the flow's entry node. Reconstructing the caller's exact position is not
    possible and pretending otherwise would replay side effects.
    """
    state = load(sid)
    if state is not None:
        return state

    from apps.telephony.models import CallLog

    call = (
        CallLog.objects.unscoped()
        .filter(provider_call_sid=sid)
        .values("id", "organization_id", "campaign_id", "contact_id",
                "flow_version_id", "to_number")
        .first()
    )
    if not call:
        logger.warning("call state missing and no CallLog row", extra={"sid": sid})
        return None

    logger.warning("call state lost, rebuilding from CallLog", extra={"sid": sid})
    return create(
        sid,
        organization_id=str(call["organization_id"]),
        campaign_id=str(call["campaign_id"]),
        contact_id=str(call["contact_id"] or ""),
        flow_version_id=str(call["flow_version_id"]),
        to_number=call["to_number"],
        rebuilt="1",
    )


def discard(sid: str) -> None:
    callstate_redis().delete(Keys.call_state(sid))
