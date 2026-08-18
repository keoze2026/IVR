"""
The flow orchestrator.

Given a flow document, the live call state and (optionally) the digits the
caller just pressed, this module decides what happens next and returns a
provider-neutral plan. Rendering that plan into TwiML or TeXML is the
renderer's job (spec 8.4); executing the side effects (recording an opt-out,
setting a disposition) is the webhook view's job.

Keeping the three separate is what makes the IVR testable without a carrier:
the whole decision surface is pure functions over dicts.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from django.conf import settings
from django.core.cache import cache

from apps.common.enums import Disposition
from apps.common.redis_clients import Keys
from apps.ivr.dsl import BRANCH_OPERATORS, MAX_TRAVERSAL_DEPTH, MERGE_TOKEN_RE

logger = logging.getLogger("ivr.webhook")

FLOW_CACHE_TTL = 3600


# ---------------------------------------------------------------------------
# Provider-neutral verbs
# ---------------------------------------------------------------------------
@dataclass
class Verb:
    name: str
    attrs: dict = field(default_factory=dict)
    text: str = ""
    children: list[Verb] = field(default_factory=list)


@dataclass
class Effect:
    """A side effect the view must perform before returning the response."""

    kind: str  # opt_out | disposition | set_variable | transfer_started
    payload: dict = field(default_factory=dict)


@dataclass
class Plan:
    verbs: list[Verb] = field(default_factory=list)
    effects: list[Effect] = field(default_factory=list)
    node_id: str = ""
    terminal: bool = False

    def add(self, verb: Verb):
        self.verbs.append(verb)
        return self

    def effect(self, kind: str, **payload):
        self.effects.append(Effect(kind, payload))
        return self


# ---------------------------------------------------------------------------
# Flow loading
# ---------------------------------------------------------------------------
def load_flow(flow_version_id: str) -> dict | None:
    """
    Fetch a published flow document, cached.

    Safe to cache indefinitely: published versions are immutable (spec 4.5),
    so the only invalidation needed is on publish, which writes a new id.
    """
    key = Keys.flow_cache(flow_version_id)
    cached = cache.get(key)
    if cached is not None:
        return cached

    from apps.ivr.models import IVRFlowVersion

    row = (
        IVRFlowVersion.objects.unscoped()
        .filter(pk=flow_version_id)
        .values("definition", "entry_node", "rendered_prompts")
        .first()
    )
    if not row:
        return None
    document = {
        "definition": row["definition"],
        "entry": row["entry_node"],
        "rendered_prompts": row["rendered_prompts"] or {},
    }
    cache.set(key, document, FLOW_CACHE_TTL)
    return document


def entry_node_id(flow: dict) -> str:
    return flow["entry"] or flow["definition"].get("entry", "")


def get_node(flow: dict, node_id: str) -> dict | None:
    return (flow["definition"].get("nodes") or {}).get(node_id)


# ---------------------------------------------------------------------------
# Prompt rendering
# ---------------------------------------------------------------------------
def render_text(template: str, context: dict) -> str:
    """
    Substitute {{merge_variables}}.

    Deliberately not a template engine. No filters, no expressions, no
    attribute traversal beyond one dotted level into the contact's own
    variables. Unknown tokens render empty rather than raising, because a
    missing merge field must not take a live call down.
    """

    def _sub(match):
        token = match.group(1)
        root, _, rest = token.partition(".")
        value = context.get(root)
        if rest and isinstance(value, dict):
            value = value.get(rest)
        return "" if value is None else str(value)

    return MERGE_TOKEN_RE.sub(_sub, template or "")


def prompt_verbs(prompt: dict, flow: dict, node_id: str, context: dict,
                 locale: str, slot: str = "prompt") -> list[Verb]:
    """Turn a prompt object into Play/Say verbs."""
    if not prompt:
        return []

    kind = prompt.get("kind")

    if kind == "audio":
        url = _asset_url(prompt.get("asset"))
        # The URL is the <Play> tag's body, not a `url` attribute: Twilio (and
        # Telnyx) read <Play>URL</Play> and ignore <Play url="URL"/>, which is
        # why an audio prompt was silent while a bare server-placed Play worked.
        return [Verb("Play", {}, url)] if url else []

    if kind == "tts":
        from apps.ivr.prompts import DYNAMIC

        key = f"{node_id}:{slot}"
        rendered = (flow.get("rendered_prompts") or {}).get(key, {})
        s3_key = rendered.get(locale) or rendered.get(
            flow["definition"].get("default_locale", "en")
        )
        if s3_key and s3_key != DYNAMIC:
            from apps.common.storage import signed_url

            return [Verb("Play", {"url": signed_url(settings.S3_BUCKET_PROMPTS, s3_key)})]
        if s3_key != DYNAMIC:
            # Not rendered yet — fall back to live speech rather than silence,
            # and say so loudly, because this costs money on every call.
            logger.warning(
                "tts prompt not pre-rendered, falling back to live Say",
                extra={"node": node_id, "slot": slot},
            )
        return [_say(prompt, context, locale)]

    if kind == "say":
        return [_say(prompt, context, locale)]

    return []


def _say(prompt: dict, context: dict, locale: str) -> Verb:
    return Verb("Say", {"language": locale},
                render_text(prompt.get("text", ""), context))


def _asset_url(asset_id) -> str:
    # Served through the app's own public URL, not a presigned MinIO link.
    #
    # The carrier fetches <Play> URLs from the public internet, where an
    # internal endpoint (http://minio:9000/...) is unreachable. The app streams
    # the object instead, at a path that is already public and HTTPS. See
    # apps/telephony/media.PromptMediaView.
    if not asset_id:
        return ""
    base = (getattr(settings, "PUBLIC_BASE_URL", "") or "").rstrip("/")
    return f"{base}/webhooks/media/prompt/{asset_id}/" if base else ""


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------
def plan_node(flow: dict, node_id: str, state, context: dict, *,
              action_url_for, locale: str = "en", depth: int = 0) -> Plan:
    """
    Build the response for arriving at `node_id`.

    Nodes that do not wait for input (play, branch, hangup with a prompt) are
    chained into one response so a three-node greeting is one HTTP round trip,
    not three. `depth` bounds that chaining; a flow that exceeds it is
    misconfigured in a way publish-time validation should have caught.
    """
    plan = Plan(node_id=node_id)
    _extend(plan, flow, node_id, state, context, action_url_for, locale, depth)
    return plan


def _extend(plan: Plan, flow: dict, node_id: str, state, context: dict,
            action_url_for, locale: str, depth: int):
    if depth > MAX_TRAVERSAL_DEPTH:
        logger.error("flow traversal depth exceeded", extra={"node": node_id})
        plan.add(Verb("Hangup"))
        plan.terminal = True
        return

    node = get_node(flow, node_id)
    if node is None:
        logger.error("flow references unknown node at runtime",
                     extra={"node": node_id})
        plan.add(Verb("Hangup"))
        plan.terminal = True
        return

    state.enter_node(node_id)
    plan.node_id = node_id
    if node.get("disposition"):
        plan.effect("disposition", value=node["disposition"])
        state.set_disposition(node["disposition"])

    handler = _HANDLERS.get(node.get("type"), _plan_hangup)
    handler(plan, flow, node_id, node, state, context, action_url_for, locale, depth)


def _plan_play(plan, flow, node_id, node, state, context, action_url_for, locale, depth):
    plan.verbs.extend(prompt_verbs(node.get("prompt"), flow, node_id, context, locale))
    if node.get("pause_after"):
        plan.add(Verb("Pause", {"length": int(node["pause_after"])}))
    nxt = node.get("next")
    if nxt:
        _extend(plan, flow, nxt, state, context, action_url_for, locale, depth + 1)
    else:
        plan.add(Verb("Hangup"))
        plan.terminal = True


def _plan_menu(plan, flow, node_id, node, state, context, action_url_for, locale, depth):
    gather = Verb(
        "Gather",
        {
            "numDigits": int(node.get("num_digits", 1)),
            "timeout": int(node.get("timeout_seconds", 5)),
            "action": action_url_for(node_id),
            "method": "POST",
            "actionOnEmptyResult": True,
        },
    )
    gather.children.extend(
        prompt_verbs(node.get("prompt"), flow, node_id, context, locale)
    )
    if node.get("finish_on_key"):
        gather.attrs["finishOnKey"] = node["finish_on_key"]
    plan.add(gather)
    # If Gather returns without input the carrier falls through to whatever
    # follows; actionOnEmptyResult keeps control in our hands instead.


def _plan_collect(plan, flow, node_id, node, state, context, action_url_for, locale, depth):
    gather = Verb(
        "Gather",
        {
            "numDigits": int(node.get("max_digits", 16)),
            "timeout": int(node.get("timeout_seconds", 8)),
            "action": action_url_for(node_id),
            "method": "POST",
            "finishOnKey": node.get("finish_on_key", "#"),
            "actionOnEmptyResult": True,
        },
    )
    gather.children.extend(
        prompt_verbs(node.get("prompt"), flow, node_id, context, locale)
    )
    plan.add(gather)


def _plan_transfer(plan, flow, node_id, node, state, context, action_url_for,
                   locale, depth):
    from apps.ivr.models import TransferEndpoint

    endpoint = (
        TransferEndpoint.objects.unscoped()
        .filter(pk=node["endpoint"], is_active=True)
        .first()
    )
    if endpoint is None:
        logger.error("transfer endpoint missing or inactive at runtime",
                     extra={"node": node_id, "endpoint": str(node.get("endpoint"))})
        fallback = node.get("on_fail")
        if fallback:
            _extend(plan, flow, fallback, state, context, action_url_for,
                    locale, depth + 1)
        else:
            plan.add(Verb("Hangup"))
            plan.terminal = True
        return

    if node.get("ring_prompt"):
        plan.verbs.extend(
            prompt_verbs(node["ring_prompt"], flow, node_id, context, locale,
                         slot="ring_prompt")
        )

    dial = Verb(
        "Dial",
        {
            "timeout": int(node.get("timeout_seconds", endpoint.timeout_seconds)),
            "action": action_url_for(node_id),
            "method": "POST",
            "record": "record-from-answer" if node.get("record") else None,
        },
    )
    dial.attrs = {k: v for k, v in dial.attrs.items() if v is not None}

    if endpoint.caller_id_override:
        dial.attrs["callerId"] = endpoint.caller_id_override

    child_attrs = {}
    if node.get("whisper"):
        # The whisper plays to the agent, not the caller — it is fetched from
        # a separate URL by the carrier when the agent leg answers.
        child_attrs["url"] = action_url_for(f"{node_id}/whisper")

    if endpoint.kind == TransferEndpoint.Kind.SIP:
        dial.children.append(Verb("Sip", child_attrs, endpoint.destination))
    else:
        dial.children.append(Verb("Number", child_attrs, endpoint.destination))

    plan.add(dial)
    plan.effect("transfer_started", endpoint_id=str(endpoint.pk),
                destination=endpoint.destination)
    state.set_disposition(Disposition.TRANSFERRED)


def _plan_opt_out(plan, flow, node_id, node, state, context, action_url_for, locale, depth):
    # The suppression is written by the view before the response is returned,
    # and the DNC cache key is deleted synchronously (spec 5.4).
    plan.effect(
        "opt_out",
        scope=node.get("scope", "organization"),
        node=node_id,
    )
    state.set_disposition(Disposition.OPTED_OUT)
    plan.verbs.extend(prompt_verbs(node.get("prompt"), flow, node_id, context, locale))
    nxt = node.get("next")
    if nxt:
        _extend(plan, flow, nxt, state, context, action_url_for, locale, depth + 1)
    else:
        plan.add(Verb("Hangup"))
        plan.terminal = True


def _plan_voicemail(plan, flow, node_id, node, state, context, action_url_for,
                    locale, depth):
    state.set_disposition(Disposition.VOICEMAIL)
    plan.verbs.extend(prompt_verbs(node.get("prompt"), flow, node_id, context, locale))
    plan.add(Verb("Hangup"))
    plan.terminal = True


def _plan_record(plan, flow, node_id, node, state, context, action_url_for, locale, depth):
    plan.verbs.extend(prompt_verbs(node.get("prompt"), flow, node_id, context, locale))
    plan.add(
        Verb(
            "Record",
            {
                "maxLength": int(node.get("max_length_seconds", 120)),
                "playBeep": bool(node.get("play_beep", True)),
                "finishOnKey": node.get("finish_on_key", "#"),
                "action": action_url_for(node_id),
                "method": "POST",
                "transcribe": bool(node.get("transcribe", False)),
            },
        )
    )


def _plan_branch(plan, flow, node_id, node, state, context, action_url_for, locale, depth):
    target = node.get("default")
    for condition in node.get("conditions") or []:
        if evaluate_condition(condition, {**context, **state.vars}):
            target = condition.get("then", target)
            break
    _extend(plan, flow, target, state, context, action_url_for, locale, depth + 1)


def _plan_hangup(plan, flow, node_id, node, state, context, action_url_for, locale, depth):
    if node.get("prompt"):
        plan.verbs.extend(
            prompt_verbs(node.get("prompt"), flow, node_id, context, locale)
        )
    plan.add(Verb("Hangup"))
    plan.terminal = True


_HANDLERS = {
    "play": _plan_play,
    "menu": _plan_menu,
    "collect": _plan_collect,
    "transfer": _plan_transfer,
    "opt_out": _plan_opt_out,
    "voicemail": _plan_voicemail,
    "record": _plan_record,
    "branch": _plan_branch,
    "hangup": _plan_hangup,
}


# ---------------------------------------------------------------------------
# Input handling
# ---------------------------------------------------------------------------
def handle_input(flow: dict, node_id: str, digits: str, state) -> tuple[str, str]:
    """
    Resolve the caller's input at `node_id`.

    Returns (next_node_id, outcome) where outcome is one of
    "matched" | "retry" | "timeout" | "invalid". The caller re-plans from the
    returned node; a "retry" returns the same node id so the prompt repeats.
    """
    node = get_node(flow, node_id)
    if node is None:
        return "", "invalid"

    node_type = node.get("type")
    digits = (digits or "").strip()

    if node_type == "menu":
        options = node.get("options") or {}
        if digits and digits in options:
            return options[digits], "matched"
        return _retry_or_fallback(node, node_id, digits, state)

    if node_type == "collect":
        lo = int(node.get("min_digits", 1))
        hi = int(node.get("max_digits", 16))
        if digits.isdigit() and lo <= len(digits) <= hi:
            state.set_var(node["variable"], digits)
            return node["next"], "matched"
        return _retry_or_fallback(node, node_id, digits, state)

    # Any other node that received input just moves on.
    return node.get("next", ""), "matched"


def _retry_or_fallback(node, node_id, digits, state) -> tuple[str, str]:
    outcome = "timeout" if not digits else "invalid"
    attempts = state.bump_attempt(node_id)
    max_attempts = int(node.get("max_attempts", 3))

    if attempts < max_attempts:
        return node_id, "retry"

    fallback = node.get("on_timeout" if outcome == "timeout" else "on_invalid")
    if not fallback:
        fallback = node.get("on_invalid") or node.get("on_timeout") or ""
    if not fallback:
        state.set_disposition(
            Disposition.NO_INPUT if outcome == "timeout" else Disposition.ABANDONED
        )
    return fallback, outcome


def evaluate_condition(condition: dict, context: dict) -> bool:
    """Evaluate one branch condition. Unknown operators are false, never raise."""
    op = condition.get("op")
    if op not in BRANCH_OPERATORS:
        return False

    token = condition.get("variable", "")
    root, _, rest = token.partition(".")
    value = context.get(root)
    if rest and isinstance(value, dict):
        value = value.get(rest)
    expected = condition.get("value")

    try:
        match op:
            case "is_set":
                return value not in (None, "")
            case "is_empty":
                return value in (None, "")
            case "eq":
                return str(value) == str(expected)
            case "neq":
                return str(value) != str(expected)
            case "in":
                return str(value) in [str(v) for v in (expected or [])]
            case "not_in":
                return str(value) not in [str(v) for v in (expected or [])]
            case "starts_with":
                return str(value or "").startswith(str(expected))
            case "gt":
                return float(value) > float(expected)
            case "gte":
                return float(value) >= float(expected)
            case "lt":
                return float(value) < float(expected)
            case "lte":
                return float(value) <= float(expected)
    except (TypeError, ValueError):
        return False
    return False
