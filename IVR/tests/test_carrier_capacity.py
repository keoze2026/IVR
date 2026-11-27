"""Calls the carrier cannot take right now wait their turn instead of being lost."""

import datetime as dt
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.campaigns.models import Campaign, CampaignContact
from apps.campaigns.services import start
from apps.campaigns.tasks import recover_throttled
from apps.common.enums import CampaignStatus, QueueState
from apps.compliance.windows import WindowDecision
from apps.dialer import tasks
from apps.dialer.providers.base import ProviderAtCapacity, ProviderRateLimited
from apps.dialer.providers.telnyx import TelnyxAdapter
from apps.telephony.models import CallLog
from tests.test_quickdial_windows import quick_dial


class Refusal:
    """A carrier's error reply."""

    ok = False
    text = "refused"
    headers: dict = {}

    def __init__(self, status, code):
        self.status_code, self._code = status, code

    def json(self):
        return {"errors": [{"code": self._code, "detail": "refused"}]}


@pytest.mark.parametrize("code", ["90041", "90042", "90043", "D3"])
def test_full_telnyx_lines_are_reported_as_capacity(code):
    with pytest.raises(ProviderAtCapacity):
        TelnyxAdapter._raise_for_status(Refusal(403, code))


def test_dialling_too_fast_is_reported_as_a_rate_limit():
    with pytest.raises(ProviderRateLimited) as caught:
        TelnyxAdapter._raise_for_status(Refusal(403, "90103"))

    assert not isinstance(caught.value, ProviderAtCapacity)


@pytest.fixture
def running_row():
    campaign, contact = quick_dial("+254700000123")
    with patch("apps.ivr.tasks.warm_flow_cache.delay"):
        if campaign.status != CampaignStatus.RUNNING:
            start(campaign, force=True)
    row, _ = CampaignContact.unfiltered.get_or_create(
        organization=campaign.organization, campaign=campaign, contact=contact
    )
    CampaignContact.unfiltered.filter(pk=row.pk).update(
        state=QueueState.DIALING, claimed_at=timezone.now()
    )
    return Campaign.unfiltered.get(pk=campaign.pk), row


@pytest.mark.django_db
def test_a_call_refused_for_capacity_goes_back_in_the_queue(running_row):
    campaign, row = running_row
    full = ProviderAtCapacity("busy", code="90043", status=403, retry_after=5)

    with (
        patch("apps.compliance.windows.is_within_window",
              return_value=WindowDecision(True)),
        patch.object(TelnyxAdapter, "place_call", side_effect=full),
    ):
        tasks.place_call(str(row.pk), str(row.pk))

    row.refresh_from_db()
    campaign.refresh_from_db()
    assert (row.state, row.attempts) == (QueueState.PENDING, 0)
    assert row.next_attempt_at > timezone.now()
    assert campaign.status == CampaignStatus.RUNNING
    assert not CallLog.unfiltered.filter(campaign=campaign).exists()


@pytest.mark.django_db
def test_a_throttled_campaign_waits_a_minute_then_resumes(running_row):
    campaign, _ = running_row
    old = timezone.now() - dt.timedelta(hours=1)
    Campaign.unfiltered.filter(pk=campaign.pk).update(updated_at=old)

    tasks._mark_throttled(campaign, "slow down")
    assert recover_throttled(max_age_minutes=1) is not None
    campaign.refresh_from_db()
    assert campaign.status == CampaignStatus.THROTTLED  # only just throttled

    Campaign.unfiltered.filter(pk=campaign.pk).update(updated_at=old)
    recover_throttled(max_age_minutes=1)
    campaign.refresh_from_db()
    assert campaign.status == CampaignStatus.RUNNING
    assert campaign.cps_limit >= 1


def test_recovery_is_on_the_schedule():
    from config.celery import app

    scheduled = {entry["task"] for entry in app.conf.beat_schedule.values()}

    assert "campaigns.recover_throttled" in scheduled


@pytest.mark.django_db
def test_a_job_accepts_thousands_of_numbers():
    numbers = " ".join(f"+2547{i:08d}" for i in range(3000))

    campaign, _ = quick_dial_many(numbers)

    assert campaign.contact_lists.get().total_rows == 3000


def quick_dial_many(numbers):
    from rest_framework.test import APIRequestFactory, force_authenticate

    from apps.accounts.models import Organization, User
    from apps.campaigns.models import CallerID
    from apps.campaigns.quickdial import QuickDialView

    org = Organization.objects.create(name="Bulk", slug="bulk")
    user = User.objects.create_user(
        username="bulk", password="x", organization=org, role="owner"
    )
    caller = CallerID.unfiltered.create(
        organization=org, phone_e164="+12135550177", provider="telnyx"
    )
    request = APIRequestFactory().post(
        "/api/v1/quick-dial/",
        {"target_number": numbers, "caller_id": str(caller.pk), "say_text": "Hi"},
        format="json",
    )
    request.organization = org
    force_authenticate(request, user=user)
    response = QuickDialView.as_view()(request)
    assert response.status_code < 300, response.data
    return Campaign.unfiltered.get(organization=org), response


def test_a_twilio_setup_error_is_reported_as_a_carrier_failure(settings):
    from twilio.base.exceptions import TwilioException

    from apps.dialer.providers.base import OriginateRequest, ProviderCallError
    from apps.dialer.providers.twilio import TwilioAdapter

    adapter = TwilioAdapter()
    request = OriginateRequest(
        to="+12125550123", from_="+12135550100",
        answer_url="https://example.test/a", status_callback_url="https://example.test/s",
    )
    with (
        patch.object(TwilioAdapter, "client", create=True) as client,
        pytest.raises(ProviderCallError) as caught,
    ):
        client.calls.create.side_effect = TwilioException("Credentials are required")
        adapter.place_call(request)

    assert caught.value.retryable
