"""
Calling-window resolution (spec 7.4).

The property under test throughout: the effective window is the intersection of
campaign, tenant and statutory rules. Operators may tighten, never widen.
"""

import datetime as dt

import pytest

from apps.compliance import windows as windows_module
from apps.compliance.windows import (
    campaign_has_open_window,
    contact_timezone,
    is_within_window,
)


@pytest.fixture(autouse=True)
def no_tenant_overrides(monkeypatch):
    """
    Isolate the intersection logic from the database.

    `jurisdiction_window` and the NPA lookup both hit Postgres on a cache miss.
    Stubbing them to "no tenant override, no state resolved" is not a
    convenience — it is the case under test here: campaign window intersected
    with the statutory ceiling and nothing else. Tenant overrides get their own
    coverage in the database-backed suite.
    """
    monkeypatch.setattr(windows_module, "jurisdiction_window",
                        lambda org_id, jurisdiction: None)
    monkeypatch.setattr(windows_module, "_state_for_npa", lambda e164: "")
    monkeypatch.setattr(windows_module, "_is_holiday", lambda day, juris: False)


def at(year, month, day, hour, minute=0, tz="UTC"):
    from zoneinfo import ZoneInfo

    return dt.datetime(year, month, day, hour, minute, tzinfo=ZoneInfo(tz))


class TestWindowChecks:
    def test_inside_window_is_allowed(self, fake_campaign, fake_contact):
        campaign = fake_campaign()
        contact = fake_contact(timezone="America/New_York")
        # Wednesday 14:00 Eastern = 19:00 UTC
        decision = is_within_window(campaign, contact, now=at(2026, 8, 5, 19))
        assert decision.allowed

    def test_before_window_opens_is_refused(self, fake_campaign, fake_contact):
        campaign = fake_campaign()
        contact = fake_contact(timezone="America/New_York")
        # 07:00 Eastern — before the campaign's 09:00 and the federal 08:00
        decision = is_within_window(campaign, contact, now=at(2026, 8, 5, 11))
        assert not decision.allowed
        assert decision.reason == "outside_hours"

    def test_weekend_is_refused_when_excluded(self, fake_campaign, fake_contact):
        campaign = fake_campaign(active_weekdays=[0, 1, 2, 3, 4])
        contact = fake_contact(timezone="America/New_York")
        # Saturday 2026-08-08, 14:00 Eastern
        decision = is_within_window(campaign, contact, now=at(2026, 8, 8, 18))
        assert not decision.allowed
        assert decision.reason == "weekday_excluded"

    def test_contact_timezone_drives_the_check(self, fake_campaign, fake_contact):
        """The same instant is inside the window for one contact and outside
        it for another. This is the whole reason the check is per-contact."""
        campaign = fake_campaign()
        now = at(2026, 8, 5, 16)  # 12:00 Eastern, 09:00 Pacific
        eastern = fake_contact(timezone="America/New_York")
        pacific = fake_contact(timezone="America/Los_Angeles")
        hawaii = fake_contact(timezone="Pacific/Honolulu")  # 06:00 local

        assert is_within_window(campaign, eastern, now=now).allowed
        assert is_within_window(campaign, pacific, now=now).allowed
        assert not is_within_window(campaign, hawaii, now=now).allowed

    def test_federal_ceiling_clamps_a_wider_campaign_window(
        self, fake_campaign, fake_contact
    ):
        """A campaign configured 06:00–23:00 must still not dial at 06:30."""
        campaign = fake_campaign(
            window_start_local=dt.time(6, 0),
            window_end_local=dt.time(23, 0),
            active_weekdays=[0, 1, 2, 3, 4, 5, 6],
        )
        contact = fake_contact(timezone="America/New_York")
        early = is_within_window(campaign, contact, now=at(2026, 8, 5, 10, 30))
        late = is_within_window(campaign, contact, now=at(2026, 8, 6, 2, 30))
        assert not early.allowed  # 06:30 local, before the 08:00 federal floor
        assert not late.allowed   # 22:30 local, after the 21:00 federal ceiling

    def test_unknown_timezone_falls_back_to_utc_not_server_local(
        self, fake_campaign, fake_contact
    ):
        campaign = fake_campaign()
        contact = fake_contact(timezone="Mars/Olympus_Mons", country_code="254",
                               phone_e164="+254712345678")
        tz = contact_timezone(contact, campaign)
        assert str(tz) == "UTC"

    def test_empty_window_is_refused(self, fake_campaign, fake_contact):
        campaign = fake_campaign(window_start_local=dt.time(17, 0),
                                 window_end_local=dt.time(9, 0))
        decision = is_within_window(campaign, fake_contact(), now=at(2026, 8, 5, 15))
        assert not decision.allowed
        assert decision.reason == "window_empty"

    def test_next_open_at_is_in_the_future(self, fake_campaign, fake_contact):
        campaign = fake_campaign()
        contact = fake_contact(timezone="America/New_York")
        now = at(2026, 8, 5, 11)  # 07:00 Eastern
        decision = is_within_window(campaign, contact, now=now)
        assert not decision.allowed
        assert decision.next_open_at is not None
        assert decision.next_open_at > now


class TestCampaignLevelPrecheck:
    def test_open_somewhere_when_any_offset_qualifies(self, fake_campaign):
        campaign = fake_campaign(active_weekdays=[0, 1, 2, 3, 4])
        assert campaign_has_open_window(campaign, now=at(2026, 8, 5, 12))

    def test_closed_everywhere_for_an_empty_window(self, fake_campaign):
        campaign = fake_campaign(window_start_local=dt.time(12, 0),
                                 window_end_local=dt.time(12, 0))
        assert not campaign_has_open_window(campaign, now=at(2026, 8, 5, 12))

    def test_precheck_is_never_stricter_than_the_per_contact_check(
        self, fake_campaign, fake_contact
    ):
        """
        The cheap campaign-level check is an optimisation. If it says closed,
        no contact may be dialable — otherwise it would silently drop work.
        """
        campaign = fake_campaign(active_weekdays=[0, 1, 2, 3, 4])
        now = at(2026, 8, 8, 12)  # Saturday
        assert not campaign_has_open_window(campaign, now=now)
        for tz in ("America/New_York", "Europe/London", "Asia/Tokyo",
                   "Africa/Nairobi"):
            assert not is_within_window(campaign, fake_contact(timezone=tz),
                                        now=now).allowed


def test_decision_is_truthy_like_a_bool(fake_campaign, fake_contact):
    decision = is_within_window(fake_campaign(), fake_contact(),
                                now=at(2026, 8, 5, 19))
    assert bool(decision) is decision.allowed
