"""Job voice, answering-machine message, live transfer and the daily call figures."""

import datetime as dt
import uuid
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.accounts.models import Organization, User
from apps.campaigns.models import CallerID, Campaign
from apps.campaigns.quickdial import QuickDialView
from apps.dialer.providers.telnyx import TelnyxAdapter
from apps.ivr import renderers, runtime
from apps.ivr.models import TransferEndpoint
from apps.ivr.validators import validate_flow
from apps.telephony.models import CallLog
from apps.telephony.views import CallLogViewSet

pytestmark = pytest.mark.django_db


@pytest.fixture
def org():
    return Organization.objects.create(name="Acme", slug="acme")


@pytest.fixture
def user(org):
    return User.objects.create_user(
        username="jane", password="x", organization=org, role="owner"
    )


def post_job(org, user, number="+12125550123", **extra):
    caller, _ = CallerID.unfiltered.get_or_create(
        organization=org, phone_e164="+12135550100", defaults={"provider": "telnyx"}
    )
    request = APIRequestFactory().post(
        "/api/v1/quick-dial/",
        {"target_number": number, "caller_id": str(caller.pk), "say_text": "Hello",
         **extra},
        format="json",
    )
    request.organization = org
    force_authenticate(request, user=user)
    return QuickDialView.as_view()(request)


def job(org, user, **extra):
    response = post_job(org, user, **extra)
    assert response.status_code == 201, response.data
    return Campaign.unfiltered.get(pk=response.data["campaign"])


def spoken(definition):
    return [
        node[slot] for node in definition["nodes"].values()
        for slot in ("prompt", "ring_prompt")
        if (node.get(slot) or {}).get("kind") == "say"
    ]


# --- defaults are unchanged ------------------------------------------------
def test_a_job_without_the_new_options_is_as_before(org, user):
    campaign = job(org, user)
    definition = campaign.flow_version.definition

    assert campaign.voicemail_node == ""
    assert not {"voicemail", "voicemail_intro"} & set(definition["nodes"])
    assert all("voice" not in prompt for prompt in spoken(definition))


# --- voice -----------------------------------------------------------------
def test_a_male_voice_reads_every_spoken_line(org, user):
    definition = job(org, user, voice="man").flow_version.definition

    assert all(prompt["voice"] == "man" for prompt in spoken(definition))


@pytest.mark.parametrize("carrier", ["telnyx", "twilio"])
def test_the_chosen_voice_reaches_the_carrier(carrier):
    verb = runtime._say({"kind": "say", "text": "Hi", "voice": "man"}, {}, "en")

    xml = renderers.render(runtime.Plan(verbs=[verb]), carrier)

    assert 'voice="man"' in xml


# --- answering machines ----------------------------------------------------
def test_a_machine_message_names_a_us_caller_then_repeats_the_message(org, user):
    campaign = job(org, user, machine_action="message")
    nodes = campaign.flow_version.definition["nodes"]

    assert campaign.voicemail_node == "voicemail_intro"
    assert nodes["voicemail_intro"]["prompt"]["text"] == "This is a call from Acme."
    assert nodes["voicemail"]["prompt"]["text"] == "Hello"


def test_a_machine_message_outside_the_us_is_just_the_message(org, user):
    campaign = job(org, user, number="+254700000123", machine_action="message")

    assert campaign.voicemail_node == "voicemail"


def test_telnyx_is_given_the_new_instructions_as_texml():
    with patch.object(TelnyxAdapter, "_post") as post:
        TelnyxAdapter().redirect("abc", twiml="<Response/>")

    assert post.call_args.args[1] == {"Texml": "<Response/>"}


def test_a_machine_verdict_leaves_the_message(org, user):
    from apps.ivr import state as call_state
    from apps.telephony.amd import handle_amd_result

    campaign = job(org, user, machine_action="message")
    sid = uuid.uuid4().hex  # callbacks are deduplicated by call id
    call_state.create(
        sid, organization_id=str(org.pk), campaign_id=str(campaign.pk),
        contact_id="", call_id="", flow_version_id=str(campaign.flow_version_id),
        queue_row_id="", provider="telnyx", to_number="+12125550123",
        locale="en", voicemail_node=campaign.voicemail_node, merge={},
    )
    with (
        patch.object(TelnyxAdapter, "redirect") as redirect,
        patch("apps.telephony.tasks.persist_amd_result.delay"),
    ):
        action = handle_amd_result("telnyx", sid, {"AnsweredBy": "machine_end_beep"})

    assert action == "voicemail"
    twiml = redirect.call_args.kwargs["twiml"]
    assert "This is a call from Acme." in twiml and "Hello" in twiml
    assert "<Hangup/>" in twiml


# --- live transfer ---------------------------------------------------------
@pytest.fixture
def agent(org):
    return TransferEndpoint.unfiltered.create(
        organization=org, name="Sales", destination="+12135550199"
    )


def test_a_key_can_connect_to_a_registered_number(org, user, agent):
    campaign = job(org, user, dtmf_steps=[
        {"digit": "1", "action": "transfer", "endpoint": str(agent.pk)},
    ])
    definition = campaign.flow_version.definition

    assert definition["nodes"]["menu"]["options"]["1"] == "transfer_1"
    report = validate_flow(definition, organization_id=org.pk)
    assert not [e for e in report.errors if e["code"] != "unreachable_node"], report.errors


@pytest.mark.parametrize("endpoint", ["", "not-an-id",
                                      "11111111-1111-4111-8111-111111111111"])
def test_an_unknown_transfer_number_is_refused(org, user, endpoint):
    response = post_job(org, user, dtmf_steps=[
        {"digit": "1", "action": "transfer", "endpoint": endpoint},
    ])

    assert response.status_code == 400
    assert not Campaign.unfiltered.filter(organization=org).exists()


def test_another_organisations_number_cannot_be_used(org, user):
    other = Organization.objects.create(name="Other", slug="other")
    theirs = TransferEndpoint.unfiltered.create(
        organization=other, name="Theirs", destination="+19005550100"
    )

    response = post_job(org, user, dtmf_steps=[
        {"digit": "1", "action": "transfer", "endpoint": str(theirs.pk)},
    ])

    assert response.status_code == 400


def test_the_transfer_dials_the_number_showing_the_jobs_caller_id(org, user, agent):
    campaign = job(org, user, dtmf_steps=[
        {"digit": "*", "action": "transfer", "endpoint": str(agent.pk)},
    ])
    flow = runtime.load_flow(str(campaign.flow_version_id))

    class State:
        def enter_node(self, _node):
            pass

        def set_disposition(self, _value):
            pass

    plan = runtime.plan_node(
        flow, "transfer_star", State(), {"caller_id": "+12135550100"},
        action_url_for=lambda node: f"https://example.test/{node}",
    )
    xml = renderers.render(plan, "telnyx")

    assert 'callerId="+12135550100"' in xml
    assert "<Number>+12135550199</Number>" in xml


# --- daily figures ---------------------------------------------------------
def trend(org, user, query=""):
    request = APIRequestFactory().get(f"/api/v1/calls/trend/{query}")
    request.organization = org
    force_authenticate(request, user=user)
    response = CallLogViewSet.as_view({"get": "trend"})(request)
    assert response.status_code == 200, response.data
    return response.data


def add_call(campaign, when, status="completed", answered_by=""):
    contact = campaign.contact_lists.get().contacts.first()
    call = CallLog.unfiltered.create(
        organization=campaign.organization, campaign=campaign, contact=contact,
        to_number=contact.phone_e164, from_number="+12135550100",
        status=status, answered_by=answered_by, provider="telnyx",
        flow_version=campaign.flow_version, provider_call_sid=uuid.uuid4().hex,
    )
    CallLog.unfiltered.filter(pk=call.pk).update(created_at=when)


def test_calls_are_counted_by_day_with_quiet_days_included(org, user):
    campaign = job(org, user)
    now = timezone.now()
    add_call(campaign, now)
    add_call(campaign, now, status="failed")
    add_call(campaign, now - dt.timedelta(days=2), status="no_answer")
    add_call(campaign, now - dt.timedelta(days=30))

    days = trend(org, user, "?days=7")["days"]

    assert len(days) == 7
    assert days[-1] == {"date": now.date().isoformat(), "total": 2,
                        "answered": 1, "failed": 1}
    assert (days[-2]["total"], days[-3]["total"]) == (0, 1)
    assert sum(day["total"] for day in days) == 3


def test_a_day_is_the_viewers_day(org, user):
    campaign = job(org, user)
    # 22:30 UTC yesterday is already today in Nairobi.
    yesterday = timezone.now().date() - dt.timedelta(days=1)
    add_call(campaign, dt.datetime.combine(yesterday, dt.time(22, 30), dt.UTC))

    nairobi = trend(org, user, "?days=7&tz=Africa/Nairobi")["days"]

    counted = [day["date"] for day in nairobi if day["total"]]
    assert counted == [(yesterday + dt.timedelta(days=1)).isoformat()]


def test_other_organisations_calls_are_not_counted(org, user):
    other = Organization.objects.create(name="Other", slug="other")
    stranger = User.objects.create_user(
        username="sam", password="x", organization=other, role="owner"
    )
    add_call(job(other, stranger), timezone.now())

    assert sum(day["total"] for day in trend(org, user)["days"]) == 0


def test_silly_parameters_fall_back(org, user):
    data = trend(org, user, "?days=100000&tz=Nowhere/City")

    assert (len(data["days"]), data["timezone"]) == (90, "UTC")
