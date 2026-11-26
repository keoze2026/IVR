"""
Which clock and which country's calling rules a quick-dial number gets.

Quick dial used to store every number as country "1" on UTC, so a Kenyan number
was held to the US 08:00-21:00 window, read in UTC, and to US holidays.
"""

import datetime as dt

import pytest
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.accounts.models import Organization, User
from apps.campaigns.models import CallerID, Campaign
from apps.campaigns.quickdial import QuickDialView
from apps.compliance.windows import is_within_window
from apps.contacts.models import Contact

pytestmark = pytest.mark.django_db


def utc(day: int, hour: int) -> dt.datetime:
    """A moment in November 2026. The 26th is US Thanksgiving."""
    return dt.datetime(2026, 11, day, hour, 30, tzinfo=dt.UTC)


def quick_dial(number: str):
    org = Organization.objects.create(name="Acme", slug="acme")
    user = User.objects.create_user(
        username="jane", password="x", organization=org, role="owner"
    )
    caller = CallerID.unfiltered.create(
        organization=org, phone_e164="+12135550100", provider="telnyx"
    )
    request = APIRequestFactory().post(
        "/api/v1/quick-dial/",
        {"target_number": number, "caller_id": str(caller.pk), "say_text": "Hello"},
        format="json",
    )
    request.organization = org
    force_authenticate(request, user=user)
    response = QuickDialView.as_view()(request)
    assert response.status_code < 300, response.data
    return (
        Campaign.unfiltered.get(organization=org),
        Contact.unfiltered.get(organization=org),
    )


def test_kenyan_number_follows_kenyan_clock_not_us_rules():
    campaign, contact = quick_dial("+254700000123")

    decision = is_within_window(campaign, contact, now=utc(26, 6))

    assert decision.allowed, (decision.reason, decision.next_open_at)
    assert decision.jurisdiction == "KE"
    assert (contact.country_code, contact.timezone) == ("254", "Africa/Nairobi")


def test_us_number_is_held_to_its_own_local_hours():
    campaign, contact = quick_dial("+12125550123")  # New York, UTC-5

    assert contact.timezone == "America/New_York"
    assert is_within_window(campaign, contact, now=utc(25, 14)).allowed  # 09:30
    early = is_within_window(campaign, contact, now=utc(25, 12))  # 07:30
    assert (early.allowed, early.reason) == (False, "outside_hours")


def test_us_number_stays_blocked_on_a_us_holiday():
    campaign, contact = quick_dial("+12125550123")

    decision = is_within_window(campaign, contact, now=utc(26, 16))

    assert (decision.allowed, decision.reason) == (False, "holiday")


def test_us_toll_free_number_uses_central_time():
    campaign, contact = quick_dial("+18002255288")

    assert contact.timezone == "America/Chicago"
    assert is_within_window(campaign, contact, now=utc(25, 15)).allowed  # 09:30
    assert not is_within_window(campaign, contact, now=utc(25, 13)).allowed  # 07:30
