"""
Answering machine detection (spec 9).

Asynchronous AMD flow (9.1)
---------------------------
Synchronous AMD makes the carrier hold the call silent until it has decided
whether a human answered — typically 2 to 4 seconds of dead air on *every*
answered call, including the human ones. Humans hang up on dead air. So AMD
runs asynchronously: the call is connected to the flow immediately, the
greeting starts playing, and the verdict arrives on a separate callback a
couple of seconds later.

That buys a good human experience at the cost of a race: when the verdict says
"machine", the call is already several seconds into a script written for a
person. The handler below resolves it by redirecting the live call to the
campaign's voicemail node (or hanging up), which is why `redirect` exists on
the provider adapter.

The race is not fully winnable, and pretending otherwise is how dialers end up
leaving half a sentence on voicemail. Two mitigations, both configuration
rather than code:

  * `DetectMessageEnd` waits for the greeting to finish before reporting, so
    the drop lands after the beep — at the cost of a later verdict.
  * Flows intended for AMD campaigns should open with a short, neutral line
    that reads acceptably to both a human and a machine.

Measuring AMD quality (9.2)
---------------------------
AMD is a classifier and it is wrong sometimes. What matters is *how* it is
wrong, and that requires ground truth, which the carrier does not provide.
`amd_latency_ms` and `answered_by` are recorded on every call so that the two
observable proxies can be tracked:

  false machine   answered_by=machine but DTMF was subsequently pressed —
                  a human was cut off. Directly measurable, and the expensive
                  error.
  false human     answered_by=human, no DTMF, duration close to the full
                  prompt length — probably a machine that got the human
                  script. Inferred, not certain.

Both are exposed as campaign KPIs rather than buried, because the correct AMD
configuration is campaign-specific and cannot be found without them.
"""

from __future__ import annotations

import logging

from apps.common.enums import MACHINE_ANSWERS, AnsweredBy, Disposition
from apps.ivr import renderers, runtime
from apps.ivr import state as call_state

logger = logging.getLogger("ivr.webhook")


def handle_amd_result(provider_name: str, sid: str, payload: dict) -> str:
    """
    Act on an asynchronous AMD verdict for a live call.

    Returns the action taken, for logging and tests: one of
    "ignored" | "hangup" | "voicemail" | "no_change".
    """
    from apps.dialer.providers import get_provider
    from apps.telephony.events import already_seen
    from apps.telephony.tasks import persist_amd_result

    raw = payload.get("AnsweredBy") or payload.get("answered_by") or ""
    if already_seen(sid, "amd", raw):
        return "ignored"

    provider = get_provider(provider_name)
    answered_by = provider.normalise_answered_by(raw)

    state = call_state.load(sid)
    if state is None:
        logger.warning("AMD result for unknown call state", extra={"sid": sid})
        persist_amd_result.delay(sid, answered_by, dict(payload))
        return "ignored"

    state.set(answered_by=answered_by).save()
    persist_amd_result.delay(sid, answered_by, dict(payload))

    if answered_by not in MACHINE_ANSWERS and answered_by != AnsweredBy.FAX:
        # Human, or unknown. Unknown is treated as human deliberately: the cost
        # of talking to a machine is a wasted minute, the cost of hanging up on
        # a person is a complaint.
        return "no_change"

    campaign = _campaign_for(state)
    if campaign is None:
        return "no_change"

    if campaign.hangup_on_machine or answered_by == AnsweredBy.FAX:
        provider.hangup(sid)
        state.set_disposition(Disposition.UNREACHABLE).save()
        return "hangup"

    voicemail_node = campaign.voicemail_node
    if not voicemail_node:
        # AMD is on but no voicemail message is configured. Hanging up is the
        # right call: playing a menu to an answering machine records a
        # nonsensical message and burns a minute of connect time.
        provider.hangup(sid)
        state.set_disposition(Disposition.UNREACHABLE).save()
        return "hangup"

    flow = runtime.load_flow(state.flow_version_id)
    if flow is None or runtime.get_node(flow, voicemail_node) is None:
        provider.hangup(sid)
        return "hangup"

    plan = runtime.plan_node(
        flow,
        voicemail_node,
        state,
        dict(state.merge or {}),
        action_url_for=lambda node_id: "",
        locale=state.data.get("locale", "en"),
    )
    state.set_disposition(Disposition.VOICEMAIL).save()

    twiml = renderers.render(plan, provider_name)
    provider.redirect(sid, twiml=twiml)
    logger.info("voicemail drop issued", extra={"sid": sid, "answered_by": answered_by})
    return "voicemail"


def _campaign_for(state):
    from apps.campaigns.models import Campaign

    if not state.campaign_id:
        return None
    return (
        Campaign.objects.unscoped()
        .filter(pk=state.campaign_id)
        .only("id", "voicemail_node", "hangup_on_machine", "amd_enabled")
        .first()
    )


def amd_quality_report(campaign) -> dict:
    """
    The two observable AMD error proxies for one campaign (spec 9.2).

    Not a substitute for listening to recordings, which is the only source of
    real ground truth — but it is the number that tells you *whether* to go
    listen.
    """
    from django.db.models import Count, Q

    from apps.telephony.models import CallLog

    stats = CallLog.objects.unscoped().filter(campaign=campaign).aggregate(
        answered=Count("id", filter=Q(answered_at__isnull=False)),
        machine=Count("id", filter=Q(answered_by__in=list(MACHINE_ANSWERS))),
        human=Count("id", filter=Q(answered_by=AnsweredBy.HUMAN)),
        unknown=Count("id", filter=Q(answered_by=AnsweredBy.UNKNOWN)),
        # A machine verdict followed by a keypress is a human who was cut off.
        machine_with_dtmf=Count(
            "id",
            filter=Q(answered_by__in=list(MACHINE_ANSWERS), dtmf__isnull=False),
            distinct=True,
        ),
        # A human verdict with no interaction and a short call is a probable
        # machine that received the human script.
        human_no_input=Count(
            "id",
            filter=Q(answered_by=AnsweredBy.HUMAN, dtmf__isnull=True,
                     duration_seconds__lt=25),
            distinct=True,
        ),
    )
    answered = stats["answered"] or 0
    return {
        **stats,
        "false_machine_rate": (stats["machine_with_dtmf"] / stats["machine"])
        if stats["machine"] else 0.0,
        "suspected_false_human_rate": (stats["human_no_input"] / stats["human"])
        if stats["human"] else 0.0,
        "machine_rate": (stats["machine"] / answered) if answered else 0.0,
    }
