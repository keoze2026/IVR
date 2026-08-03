"""
Carrier webhook views (spec 8).

Latency budget (spec 8.1)
-------------------------
The carrier expects TwiML back in a couple of seconds and treats a slow
response as a failure — audible to the caller as dead air, then a hangup. The
budget these views work to:

    signature verification      < 5 ms   (HMAC / Ed25519, no I/O)
    Redis call-state read       < 5 ms   (one HGETALL)
    flow document               < 1 ms   (process-local cache, then Redis)
    plan + render               < 5 ms   (pure functions)
    ------------------------------------------------------
    target                      < 50 ms p99, hard ceiling 200 ms

Nothing in the response path writes to Postgres. Durable persistence is pushed
onto the events queue; a database write here would put the primary's fsync
latency inside the carrier's critical path, and a slow query would turn into
dropped calls rather than a slow dashboard.

The one deliberate exception is the opt-out path, which writes its suppression
synchronously before returning. A caller who presses 9 must be suppressed by
the time the call ends, even if the events queue is backed up.
"""

from __future__ import annotations

import logging
import time

from django.http import HttpResponse, HttpResponseForbidden
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from apps.common.enums import Disposition
from apps.ivr import renderers, runtime
from apps.ivr import state as call_state
from apps.telephony import signatures

logger = logging.getLogger("ivr.webhook")

XML = "text/xml; charset=utf-8"


@method_decorator(csrf_exempt, name="dispatch")
class BaseWebhookView(View):
    """
    Shared plumbing: signature verification, payload parsing, timing.

    CSRF is exempt because there is no session to protect; authenticity comes
    from the provider signature, which is strictly stronger than a CSRF token
    for this threat model.
    """

    provider_name = "twilio"

    def dispatch(self, request, *args, **kwargs):
        started = time.monotonic()
        self.provider_name = kwargs.get("provider", "twilio")

        if not signatures.verify(request, self.provider_name):
            logger.warning(
                "webhook signature rejected",
                extra={"provider": self.provider_name, "path": request.path},
            )
            return HttpResponseForbidden("Invalid signature.")

        try:
            response = super().dispatch(request, *args, **kwargs)
        finally:
            elapsed_ms = (time.monotonic() - started) * 1000
            if elapsed_ms > 200:
                logger.warning(
                    "webhook exceeded latency budget",
                    extra={"ms": round(elapsed_ms), "path": request.path},
                )
        return response

    # --- helpers --------------------------------------------------------
    @staticmethod
    def payload(request) -> dict:
        if request.content_type == "application/json":
            import json

            try:
                return json.loads(request.body or b"{}")
            except ValueError:
                return {}
        return request.POST.dict()

    def xml(self, plan_or_string) -> HttpResponse:
        body = (
            plan_or_string
            if isinstance(plan_or_string, str)
            else renderers.render(plan_or_string, self.provider_name)
        )
        return HttpResponse(body, content_type=XML)

    def hangup(self) -> HttpResponse:
        return self.xml(renderers.hangup_response(self.provider_name))

    def action_url_factory(self, sid: str):
        """Build the URL the carrier posts DTMF back to, for a given node."""

        def _url(node_id: str) -> str:
            from django.conf import settings

            return (
                f"{settings.PUBLIC_BASE_URL.rstrip('/')}"
                f"/webhooks/{self.provider_name}/ivr/gather/"
                f"?sid={sid}&node={node_id}"
            )

        return _url


class IVREntryView(BaseWebhookView):
    """
    First request after the call is answered.

    Plans from the flow's entry node and returns the whole non-interactive
    prefix in one response (greeting → disclosure → menu), so a three-node
    opening is one round trip rather than three.
    """

    def post(self, request, provider=None):
        data = self.payload(request)
        sid = data.get("CallSid") or request.GET.get("sid", "")
        if not sid:
            return self.hangup()

        state = call_state.load_or_rebuild(sid)
        if state is None:
            logger.error("entry webhook for unknown call", extra={"sid": sid})
            return self.hangup()

        flow = runtime.load_flow(state.flow_version_id)
        if flow is None:
            logger.error("entry webhook for unknown flow",
                         extra={"flow": state.flow_version_id})
            return self.hangup()

        # An early AMD verdict can arrive before the entry request when the
        # carrier detects a machine during ringing. Honour it rather than
        # playing the human script to an answering machine.
        start_node = _machine_override(state, flow) or runtime.entry_node_id(flow)

        context = _merge_context(state)
        plan = runtime.plan_node(
            flow, start_node, state, context,
            action_url_for=self.action_url_factory(sid),
            locale=state.data.get("locale", "en"),
        )
        _apply_effects(plan, state, sid)
        state.save()

        _enqueue_event(sid, "answered", data, state)
        return self.xml(plan)


class IVRGatherView(BaseWebhookView):
    """Handles DTMF input, Dial results and Record results for one node."""

    def post(self, request, provider=None):
        data = self.payload(request)
        sid = data.get("CallSid") or request.GET.get("sid", "")
        node_id = request.GET.get("node", "")
        if not sid or not node_id:
            return self.hangup()

        state = call_state.load_or_rebuild(sid)
        if state is None:
            return self.hangup()

        flow = runtime.load_flow(state.flow_version_id)
        if flow is None:
            return self.hangup()

        node = runtime.get_node(flow, node_id)
        if node is None:
            return self.hangup()

        # A Dial that has returned reports its outcome instead of digits.
        if "DialCallStatus" in data:
            return self._handle_dial_result(request, data, sid, node_id, node,
                                            flow, state)
        if "RecordingUrl" in data and node.get("type") == "record":
            return self._handle_record_result(data, sid, node_id, node, flow, state)

        digits = data.get("Digits", "")
        next_node, outcome = runtime.handle_input(flow, node_id, digits, state)

        if outcome == "matched" and digits:
            _enqueue_dtmf(sid, node_id, digits, state, valid=True)
        elif outcome in ("invalid", "retry") and digits:
            _enqueue_dtmf(sid, node_id, digits, state, valid=False)

        if not next_node:
            state.set_disposition(
                Disposition.NO_INPUT if not digits else Disposition.ABANDONED
            )
            state.save()
            _enqueue_event(sid, "ivr_end", data, state)
            return self.hangup()

        if outcome == "retry":
            # Replay the same node, optionally prefixed with the "sorry, I
            # didn't get that" prompt.
            plan = runtime.plan_node(
                flow, node_id, state, _merge_context(state),
                action_url_for=self.action_url_factory(sid),
                locale=state.data.get("locale", "en"),
            )
            reprompt = node.get("invalid_prompt" if digits else "timeout_prompt")
            if reprompt:
                verbs = runtime.prompt_verbs(
                    reprompt, flow, node_id, _merge_context(state),
                    state.data.get("locale", "en"),
                    slot="invalid_prompt" if digits else "timeout_prompt",
                )
                plan.verbs = verbs + plan.verbs
            state.save()
            return self.xml(plan)

        plan = runtime.plan_node(
            flow, next_node, state, _merge_context(state),
            action_url_for=self.action_url_factory(sid),
            locale=state.data.get("locale", "en"),
        )
        _apply_effects(plan, state, sid)
        state.save()
        return self.xml(plan)

    def _handle_dial_result(self, request, data, sid, node_id, node, flow, state):
        status = (data.get("DialCallStatus") or "").lower()
        duration = int(data.get("DialCallDuration") or 0)
        state.set(transfer_status=status, transfer_duration=duration)

        if status == "completed":
            state.set_disposition(Disposition.TRANSFERRED)
            state.save()
            _enqueue_event(sid, "transfer_completed", data, state)
            return self.hangup()

        # Nobody picked up on the agent side. Fall back rather than dropping
        # the caller into silence.
        fallback = node.get("on_fail")
        state.save()
        _enqueue_event(sid, "transfer_failed", data, state)
        if not fallback:
            return self.hangup()
        plan = runtime.plan_node(
            flow, fallback, state, _merge_context(state),
            action_url_for=self.action_url_factory(sid),
            locale=state.data.get("locale", "en"),
        )
        _apply_effects(plan, state, sid)
        state.save()
        return self.xml(plan)

    def _handle_record_result(self, data, sid, node_id, node, flow, state):
        state.set(recording_url=data.get("RecordingUrl", ""),
                  recording_duration=data.get("RecordingDuration", "0"))
        state.save()
        _enqueue_event(sid, "recording_captured", data, state)

        nxt = node.get("next")
        if not nxt:
            return self.hangup()
        plan = runtime.plan_node(
            flow, nxt, state, _merge_context(state),
            action_url_for=self.action_url_factory(sid),
            locale=state.data.get("locale", "en"),
        )
        _apply_effects(plan, state, sid)
        state.save()
        return self.xml(plan)


class WhisperView(BaseWebhookView):
    """Plays the agent-side whisper on a transfer leg."""

    def post(self, request, provider=None):
        sid = request.GET.get("sid", "")
        node_id = request.GET.get("node", "")
        state = call_state.load(sid) if sid else None
        if state is None:
            return self.hangup()
        flow = runtime.load_flow(state.flow_version_id)
        node = runtime.get_node(flow, node_id) if flow else None
        if not node or not node.get("whisper"):
            return self.xml(renderers.render(runtime.Plan(), self.provider_name))
        verbs = runtime.prompt_verbs(
            node["whisper"], flow, node_id, _merge_context(state),
            state.data.get("locale", "en"), slot="whisper",
        )
        return self.xml(runtime.Plan(verbs=verbs))


class AMDView(BaseWebhookView):
    """Asynchronous answering-machine detection result (spec 9.1)."""

    def post(self, request, provider=None):
        from apps.telephony.amd import handle_amd_result

        data = self.payload(request)
        sid = data.get("CallSid") or request.GET.get("sid", "")
        if not sid:
            return HttpResponse(status=204)

        handle_amd_result(self.provider_name, sid, data)
        # The carrier does not act on the body of this callback; the redirect
        # is issued out-of-band via the REST API.
        return HttpResponse(status=204)


class StatusCallbackView(BaseWebhookView):
    """
    Call status transitions. The highest-volume webhook by a wide margin —
    four per call minimum — and the one that must never block.
    """

    def post(self, request, provider=None):
        from apps.telephony.events import ingest_status_callback

        data = self.payload(request)
        sid = data.get("CallSid") or ""
        if not sid:
            return HttpResponse(status=204)
        ingest_status_callback(self.provider_name, sid, data)
        return HttpResponse(status=204)


class RecordingCallbackView(BaseWebhookView):
    def post(self, request, provider=None):
        from apps.telephony.tasks import persist_recording

        data = self.payload(request)
        sid = data.get("CallSid") or ""
        if sid:
            persist_recording.delay(self.provider_name, sid, data)
        return HttpResponse(status=204)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _merge_context(state) -> dict:
    """
    Merge fields available to prompts on this call.

    Read from the call state rather than the database: the contact row was
    already read when the call was placed, and re-reading it here would put a
    query in the response path for data that cannot have changed mid-call.
    """
    context = dict(state.merge or {})
    context.update(state.vars or {})
    return context


def _machine_override(state, flow) -> str | None:
    """If AMD already said 'machine', start at the campaign's voicemail node."""
    from apps.common.enums import MACHINE_ANSWERS

    if state.answered_by not in MACHINE_ANSWERS:
        return None
    node_id = state.data.get("voicemail_node", "")
    return node_id if node_id and runtime.get_node(flow, node_id) else None


def _apply_effects(plan, state, sid: str):
    """
    Execute a plan's side effects before its XML is returned.

    Opt-out is the only one that touches the database synchronously, and it
    does so deliberately: the suppression and the DNC cache invalidation must
    both be durable before the caller hears the confirmation.
    """
    for effect in plan.effects:
        if effect.kind == "opt_out":
            _record_opt_out(state, sid, effect.payload)
        elif effect.kind == "transfer_started":
            state.set(transfer_endpoint=effect.payload.get("endpoint_id", ""),
                      transferred_to=effect.payload.get("destination", ""))
        elif effect.kind == "disposition":
            state.set_disposition(effect.payload.get("value", ""))


def _record_opt_out(state, sid: str, payload: dict):
    from apps.compliance.services import record_opt_out

    scope_campaign = None
    if payload.get("scope") == "campaign":
        from apps.campaigns.models import Campaign

        scope_campaign = (
            Campaign.objects.unscoped().filter(pk=state.campaign_id).first()
        )
    try:
        record_opt_out(
            state.organization_id,
            state.to_number,
            scope_campaign=scope_campaign,
            notes=f"IVR opt-out at node {payload.get('node', '')} (call {sid})",
        )
        state.set(opted_out="1")
    except Exception:  # noqa: BLE001 - never fail the call over bookkeeping
        logger.exception("failed to record opt-out synchronously",
                         extra={"sid": sid})
        # Fall back to the durable path so the opt-out is not lost.
        from apps.telephony.tasks import record_opt_out_task

        record_opt_out_task.delay(state.organization_id, state.to_number, sid)


def _enqueue_event(sid: str, event_type: str, payload: dict, state):
    from apps.telephony.tasks import persist_call_event

    persist_call_event.delay(
        sid, event_type, _scrub(payload),
        {"node": state.node, "path": state.path,
         "disposition": state.disposition, "campaign_id": state.campaign_id},
    )


def _enqueue_dtmf(sid: str, node_id: str, digits: str, state, *, valid: bool):
    from apps.telephony.tasks import persist_dtmf

    persist_dtmf.delay(sid, node_id, digits, valid, state.campaign_id)


def _scrub(payload: dict) -> dict:
    """Drop provider fields that duplicate PII we already hold."""
    return {k: v for k, v in payload.items() if k not in {"Called", "Caller"}}
