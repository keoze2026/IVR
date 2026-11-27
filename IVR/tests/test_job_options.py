"""US opt-out, retries and the call report download."""

import pytest
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.accounts.models import Organization, User
from apps.campaigns.models import CallerID, Campaign
from apps.campaigns.quickdial import QuickDialView
from apps.ivr.validators import validate_flow
from apps.telephony.models import CallLog
from apps.telephony.views import CallLogViewSet

pytestmark = pytest.mark.django_db


def create(number="+12125550123", **extra):
    org = Organization.objects.create(name="Acme Utilities", slug="acme")
    user = User.objects.create_user(
        username="jane", password="x", organization=org, role="owner"
    )
    caller = CallerID.unfiltered.create(
        organization=org, phone_e164="+12135550100", provider="telnyx"
    )
    request = APIRequestFactory().post(
        "/api/v1/quick-dial/",
        {"target_number": number, "caller_id": str(caller.pk), "say_text": "Hello",
         **extra},
        format="json",
    )
    request.organization = org
    force_authenticate(request, user=user)
    response = QuickDialView.as_view()(request)
    assert response.status_code < 300, response.data
    return Campaign.unfiltered.get(organization=org), user


def path(definition):
    """The nodes passed through when no key is pressed."""
    nodes, current, seen = definition["nodes"], definition["entry"], []
    while current and current not in seen:
        seen.append(current)
        node = nodes[current]
        current = node.get("next") or node.get("on_timeout")
    return seen


def test_a_us_job_names_the_caller_and_offers_press_9():
    campaign, _ = create()
    definition = campaign.flow_version.definition

    assert path(definition) == ["disclosure", "caller", "play", "stop_menu", "done"]
    assert "Acme Utilities" in definition["nodes"]["caller"]["prompt"]["text"]
    stop = definition["nodes"]["stop_menu"]
    assert stop["options"] == {"9": "optout"}
    assert (stop["max_attempts"], "press 9" in stop["prompt"]["text"]) == (1, True)
    assert not validate_flow(definition).errors


def test_a_us_job_with_keys_gets_9_added_but_keeps_a_chosen_9():
    campaign, _ = create(dtmf_steps=[{"digit": "1", "action": "confirm"}])
    menu = campaign.flow_version.definition["nodes"]["menu"]

    assert menu["options"] == {"1": "confirm", "9": "optout"}
    assert not validate_flow(campaign.flow_version.definition).errors


def test_a_job_with_no_us_number_is_unchanged():
    campaign, _ = create("+254700000123")

    assert path(campaign.flow_version.definition) == ["disclosure", "play", "done"]


def test_the_us_opt_out_can_be_switched_off(settings):
    settings.QUICK_DIAL_US_OPT_OUT = False
    campaign, _ = create()

    assert path(campaign.flow_version.definition) == ["disclosure", "play", "done"]


def test_each_number_is_tried_once_unless_asked():
    campaign, _ = create()

    assert campaign.max_attempts == 1


def test_retries_redial_busy_and_unanswered_numbers():
    campaign, _ = create(max_attempts=3, retry_delay_minutes=5)

    assert (campaign.max_attempts, campaign.max_attempts_per_day) == (3, 3)
    assert (campaign.retry_delay_minutes, campaign.retry_backoff_factor) == (5, 1.0)
    assert campaign.retry_on_statuses == ["busy", "no_answer"]


def download(user):
    request = APIRequestFactory().get("/api/v1/calls/export/")
    request.organization = user.organization
    force_authenticate(request, user=user)
    return CallLogViewSet.as_view({"get": "export"})(request)


def test_the_download_masks_numbers_and_defuses_formulas():
    campaign, user = create("+254700000123", name="=HYPERLINK(1)")
    CallLog.unfiltered.create(
        organization=campaign.organization, campaign=campaign,
        contact=campaign.contact_lists.get().contacts.first(),
        flow_version=campaign.flow_version, provider="telnyx",
        provider_call_sid="s1", from_number="+12135550100",
        to_number="+254700000123", status="completed", duration_seconds=12,
    )

    response = download(user)
    text = b"".join(response.streaming_content).decode()

    assert response["Content-Disposition"].endswith('"call-records.csv"')
    assert "'=HYPERLINK(1)" in text
    assert "254700000123" not in text
    assert ",completed," in text and ",12," in text


def test_the_download_needs_the_export_permission():
    _, owner = create()
    operator = User.objects.create_user(
        username="op", password="x", organization=owner.organization, role="operator"
    )

    assert download(operator).status_code == 403
