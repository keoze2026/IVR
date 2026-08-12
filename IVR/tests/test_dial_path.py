"""
The dispatch task (spec 7.5) — everything up to the carrier, without one.

`place_call` is the last checkpoint before money is spent and a stranger's
phone rings. The pacer has already authorised the dial, so this task's whole
job is re-checking what can change in the gap between that decision and the
dial itself: suppression, campaign state, calling window. "The row was claimed
800ms ago" is not a defence, and every one of those re-checks failing open
looks identical to it working — the call simply goes out.

The provider adapter is replaced with a fake, so these tests assert the two
things that matter and cannot be seen from a passing dial: whether the carrier
was called *at all*, and whether the channel reservation was given back.
"""

import datetime as dt

import pytest
from freezegun import freeze_time


@pytest.fixture(autouse=True)
def _inside_the_calling_window():
    """
    Pin the clock to the middle of the day.

    These fixtures dial a +1 212 number, so the statutory US federal window of
    08:00-21:00 applies on top of the campaign's own 00:00-23:59. Without a
    fixed clock the suite passes during the working day and fails overnight —
    the gate refusing correctly, but reading as flakiness because nothing in
    the failure mentions the time.

    Frozen rather than widened: the federal ceiling is exactly the behaviour
    these tests exist to exercise, so removing it from the path would test a
    configuration that never runs in production.
    """
    with freeze_time("2026-08-12 12:00:00"):
        yield

pytestmark = pytest.mark.django_db


class FakeProvider:
    """Records what it was asked to dial instead of dialling it."""

    def __init__(self, sid="CA-fake-sid", raises=None):
        self.sid = sid
        self.raises = raises
        self.requests = []
        self.call_log_existed = None

    def place_call(self, request):
        from apps.telephony.models import CallLog

        self.requests.append(request)
        # The CallLog must already be durable at this instant: a status
        # callback can beat our own response to the originate call.
        self.call_log_existed = CallLog.objects.unscoped().filter(
            to_number=request.to
        ).exists()
        if self.raises:
            raise self.raises
        from apps.dialer.providers.base import CallHandle

        return CallHandle(sid=self.sid, status="queued")

    @property
    def dialled(self) -> bool:
        return bool(self.requests)

    @staticmethod
    def normalise_status(status):
        from apps.common.enums import CallStatus

        return CallStatus.QUEUED


@pytest.fixture
def provider(monkeypatch):
    fake = FakeProvider()

    def _install(p):
        from apps.dialer import tasks

        monkeypatch.setattr(tasks, "get_provider", lambda *_a, **_k: p)
        return p

    fake.install = _install
    return _install(fake)


@pytest.fixture
def dial(db, redis_client, settings):
    """A campaign with one claimed queue row, ready to dispatch."""
    from django.utils import timezone

    from apps.accounts.models import Organization
    from apps.campaigns.models import CallerID, Campaign, CampaignContact
    from apps.common.enums import CampaignStatus, QueueState
    from apps.common.utils import phone_hash
    from apps.contacts.models import Contact, ContactList
    from apps.dialer.limits import ChannelSemaphore
    from apps.ivr.models import IVRFlow, IVRFlowVersion

    settings.TENANCY_STRICT = True
    org = Organization.objects.create(name="Acme", slug="acme-dial",
                                      max_cps=10.0, max_concurrent_channels=100)
    flow = IVRFlow.objects.create(organization=org, name="F")
    version = IVRFlowVersion.objects.create(
        organization=org, flow=flow, version=1, is_published=True,
        entry_node="greeting",
        definition={"schema_version": "1.0", "entry": "greeting", "nodes": {
            "greeting": {"type": "hangup",
                         "prompt": {"kind": "tts", "text": "Hi."}}}},
    )
    campaign = Campaign.objects.create(
        organization=org, name="C", flow_version=version,
        status=CampaignStatus.RUNNING,
        requires_consent=False,          # consent is gated in its own tests
        caller_id=CallerID.objects.create(
            organization=org, phone_e164="+15005550006", provider="twilio"
        ),
        window_start_local=dt.time(0, 0), window_end_local=dt.time(23, 59),
        active_weekdays=[0, 1, 2, 3, 4, 5, 6],
        respect_contact_timezone=False, fallback_timezone="UTC",
    )
    number = "+12125550123"
    contact = Contact.objects.create(
        organization=org, contact_list=ContactList.objects.create(
            organization=org, name="L"),
        phone_e164=number, phone_hash=phone_hash(number), timezone="UTC",
    )
    # Matches what pacer.claim_rows leaves behind: DIALING with a claimed_at
    # stamp. That timestamp is what telephony.sweep_stuck_calls keys on to
    # requeue a row whose dispatch worker died.
    row = CampaignContact.objects.create(
        organization=org, campaign=campaign, contact=contact,
        state=QueueState.DIALING, claimed_at=timezone.now(),
    )

    # Reserve a channel exactly as the pacer would have before dispatching.
    semaphore = ChannelSemaphore(campaign.pk, campaign.effective_channels())
    reservation = str(row.pk)
    assert semaphore.acquire(reservation) is True
    assert semaphore.live() == 1

    return {
        "org": org, "campaign": campaign, "contact": contact, "row": row,
        "semaphore": semaphore, "reservation": reservation, "number": number,
    }


def run_dispatch(dial):
    from apps.dialer.tasks import place_call

    place_call.run(str(dial["row"].pk), dial["reservation"])


# ---------------------------------------------------------------------------
# The re-checks. Each one failing open means a call that should not happen.
# ---------------------------------------------------------------------------
class TestPreDialGates:
    def test_a_suppressed_number_is_never_dialled(self, dial, provider):
        """"Add your number to /dnc/, start the campaign" — README, Tier 5."""
        from apps.common.enums import QueueState
        from apps.compliance.services import record_opt_out

        record_opt_out(dial["org"].pk, dial["number"])

        run_dispatch(dial)

        assert not provider.dialled, (
            "a suppressed number was dialled — the pre-dial check was skipped"
        )
        dial["row"].refresh_from_db()
        assert dial["row"].state == QueueState.SUPPRESSED
        assert dial["semaphore"].live() == 0, "channel leaked on a suppressed row"

    def test_a_contact_outside_the_calling_window_is_not_dialled(self, dial,
                                                                 provider):
        """"Set the window to a past hour, start the campaign: no calls."

        Note `active_weekdays = []` would NOT do this — empty means "unset", so
        it widens the campaign to all seven days (preflight warns about it).
        Excluding today explicitly is what closes the window.
        """
        from django.utils import timezone

        from apps.common.enums import QueueState

        campaign = dial["campaign"]
        today = timezone.now().weekday()
        campaign.active_weekdays = [d for d in range(7) if d != today]
        campaign.save(update_fields=["active_weekdays"])

        run_dispatch(dial)

        assert not provider.dialled, "dialled outside the permitted window"
        dial["row"].refresh_from_db()
        assert dial["row"].state == QueueState.PENDING, (
            "an out-of-window row must return to the queue, not be consumed"
        )
        assert dial["row"].next_attempt_at is not None, (
            "requeued with no next_attempt_at; it would be retried immediately"
        )
        assert dial["semaphore"].live() == 0, "channel leaked out of window"

    def test_an_empty_weekday_list_widens_rather_than_closes_the_window(
        self, dial, provider
    ):
        """Pinning the sharp edge above, so a change here is deliberate.

        Clearing the weekday list reads like "never dial", and does the
        opposite. Preflight reports it as a warning, not an error.
        """
        from apps.campaigns.services import preflight

        campaign = dial["campaign"]
        campaign.active_weekdays = []
        campaign.save(update_fields=["active_weekdays"])

        run_dispatch(dial)
        assert provider.dialled, "behaviour changed; update the preflight warning"

        report = preflight(campaign)
        assert any(w["code"] == "all_weekdays" for w in report["warnings"]), (
            "the seven-day-a-week warning is the only thing telling an "
            "operator that clearing the list widened the campaign"
        )

    def test_a_paused_campaign_does_not_dial(self, dial, provider):
        """Pause between the pacer's decision and the dial."""
        from apps.common.enums import CampaignStatus, QueueState

        campaign = dial["campaign"]
        campaign.status = CampaignStatus.PAUSED
        campaign.save(update_fields=["status"])

        run_dispatch(dial)

        assert not provider.dialled, "a paused campaign placed a call"
        dial["row"].refresh_from_db()
        assert dial["row"].state == QueueState.PENDING
        assert dial["semaphore"].live() == 0

    def test_a_suspended_organisation_does_not_dial(self, dial, provider):
        org = dial["org"]
        org.is_suspended = True
        org.save(update_fields=["is_suspended"])

        run_dispatch(dial)

        assert not provider.dialled, "a suspended organisation placed a call"
        assert dial["semaphore"].live() == 0

    def test_consent_is_required_when_the_campaign_says_so(self, dial, provider):
        """"Preflight blocks before consent exists" — the consent gate."""
        from apps.common.enums import QueueState

        campaign = dial["campaign"]
        campaign.requires_consent = True
        campaign.save(update_fields=["requires_consent"])

        run_dispatch(dial)

        assert not provider.dialled, (
            "dialled without a consent record on a consent-required campaign"
        )
        dial["row"].refresh_from_db()
        assert dial["row"].state == QueueState.SUPPRESSED
        assert dial["semaphore"].live() == 0


# ---------------------------------------------------------------------------
# The successful path, and the invariants it has to hold.
# ---------------------------------------------------------------------------
class TestSuccessfulDial:
    def test_the_call_is_recorded_before_the_carrier_is_called(self, dial,
                                                               provider):
        """A callback can arrive before the originate response does."""
        run_dispatch(dial)

        assert provider.dialled
        assert provider.call_log_existed is True, (
            "the carrier was called before a CallLog existed; an early "
            "callback would have nothing to attach to"
        )

    def test_the_reservation_is_rekeyed_to_the_call_sid(self, dial, provider):
        """Held on the queue-row id, re-keyed to the SID once one exists.

        The status callback releases the channel and only knows the SID. If the
        rename does not happen the reservation is never freed and the campaign
        silently strangles itself at its channel ceiling.
        """
        run_dispatch(dial)

        semaphore = dial["semaphore"]
        assert semaphore.live() == 1, "the channel was released while live"
        assert provider.sid in semaphore.members()
        assert dial["reservation"] not in semaphore.members(), (
            "still held under the queue-row id; the status callback will not "
            "be able to release it"
        )

    def test_the_queue_row_and_contact_are_marked_attempted(self, dial, provider):
        from apps.common.enums import QueueState

        run_dispatch(dial)

        dial["row"].refresh_from_db()
        dial["contact"].refresh_from_db()
        assert dial["row"].state == QueueState.DIALING
        assert dial["row"].attempts == 1
        assert dial["contact"].total_attempts == 1
        assert dial["contact"].last_called_at is not None

    def test_the_callbacks_point_at_the_public_base_url(self, dial, provider,
                                                        settings):
        """Signature verification rebuilds the URL from this value."""
        run_dispatch(dial)

        request = provider.requests[0]
        for url in (request.answer_url, request.status_callback_url):
            assert url.startswith(settings.PUBLIC_BASE_URL), (
                f"{url} is not under PUBLIC_BASE_URL; every callback would 403"
            )


# ---------------------------------------------------------------------------
# Carrier failure. The channel must come back in every branch.
# ---------------------------------------------------------------------------
class TestCarrierFailure:
    def test_rate_limiting_throttles_the_campaign_and_requeues(self, dial,
                                                               monkeypatch):
        """"The carrier is telling us our pacing is wrong. Believe it."""
        from apps.common.enums import CampaignStatus, QueueState
        from apps.dialer import tasks
        from apps.dialer.providers.base import ProviderRateLimited

        fake = FakeProvider(raises=ProviderRateLimited("slow down"))
        monkeypatch.setattr(tasks, "get_provider", lambda *_a, **_k: fake)

        run_dispatch(dial)

        dial["row"].refresh_from_db()
        dial["campaign"].refresh_from_db()
        assert dial["row"].state == QueueState.PENDING, "the row was consumed"
        assert dial["row"].next_attempt_at is not None, "requeued with no backoff"
        assert dial["campaign"].status == CampaignStatus.THROTTLED
        assert dial["semaphore"].live() == 0, "channel leaked on a 429"

    def test_a_permanent_carrier_error_releases_the_channel(self, dial,
                                                            monkeypatch):
        from apps.dialer import tasks
        from apps.dialer.providers.base import ProviderCallError

        fake = FakeProvider(
            raises=ProviderCallError("invalid number", code="21217",
                                     status=400, retryable=False)
        )
        monkeypatch.setattr(tasks, "get_provider", lambda *_a, **_k: fake)

        run_dispatch(dial)

        assert dial["semaphore"].live() == 0, (
            "channel leaked on a permanent carrier error; the campaign will "
            "grind to a halt at its ceiling"
        )
