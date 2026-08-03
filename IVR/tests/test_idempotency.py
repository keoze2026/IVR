"""
Webhook idempotency and ordering (spec 8.5).

Providers retry and reorder. These are the two failure modes that turn a
correct-looking dialer into one that double-counts answers and resurrects
completed calls.
"""

import pytest

from apps.common.enums import CallStatus
from apps.telephony.events import already_seen, is_forward_transition, normalise_payload


class TestDeduplication:
    def test_first_delivery_is_not_a_duplicate(self, fake_redis):
        assert already_seen("CA1", "status:completed", 4) is False

    def test_second_delivery_of_the_same_callback_is(self, fake_redis):
        already_seen("CA1", "status:completed", 4)
        assert already_seen("CA1", "status:completed", 4) is True

    def test_different_sequence_numbers_are_distinct(self, fake_redis):
        already_seen("CA1", "status:ringing", 1)
        assert already_seen("CA1", "status:ringing", 2) is False

    def test_different_calls_are_distinct(self, fake_redis):
        already_seen("CA1", "status:completed", 4)
        assert already_seen("CA2", "status:completed", 4) is False

    def test_missing_sequence_number_still_dedupes(self, fake_redis):
        already_seen("CA1", "amd", None)
        assert already_seen("CA1", "amd", None) is True

    def test_fails_open_when_redis_is_down(self, monkeypatch):
        """
        Dropping a `completed` callback leaks a channel and strands a queue
        row. Processing a duplicate is recoverable. So this fails open.
        """
        from redis.exceptions import ConnectionError as RedisConnectionError

        from apps.telephony import events

        def boom():
            raise RedisConnectionError("down")

        monkeypatch.setattr(events, "counters_redis", boom)
        assert already_seen("CA1", "status:completed", 4) is False


class TestOrdering:
    @pytest.mark.parametrize(
        "current,incoming,expected",
        [
            ("", CallStatus.QUEUED, True),
            (CallStatus.QUEUED, CallStatus.RINGING, True),
            (CallStatus.RINGING, CallStatus.IN_PROGRESS, True),
            (CallStatus.IN_PROGRESS, CallStatus.COMPLETED, True),
            # Reordered deliveries must not move the call backwards.
            (CallStatus.COMPLETED, CallStatus.RINGING, False),
            (CallStatus.COMPLETED, CallStatus.IN_PROGRESS, False),
            (CallStatus.IN_PROGRESS, CallStatus.QUEUED, False),
            # Equal rank: a later terminal verdict re-classifies the earlier one.
            (CallStatus.NO_ANSWER, CallStatus.BUSY, True),
        ],
    )
    def test_transition_ordering(self, current, incoming, expected):
        assert is_forward_transition(current, incoming) is expected

    def test_completed_is_the_highest_rank(self):
        for status in (CallStatus.BUSY, CallStatus.FAILED, CallStatus.NO_ANSWER,
                       CallStatus.CANCELED):
            assert is_forward_transition(status, CallStatus.COMPLETED)
            assert not is_forward_transition(CallStatus.COMPLETED, status)


class TestPayloadNormalisation:
    def test_twilio_completed_payload(self):
        payload = {
            "CallStatus": "completed",
            "CallDuration": "42",
            "SequenceNumber": "4",
            "Price": "-0.01300",
            "PriceUnit": "USD",
            "AnsweredBy": "human",
        }
        fields = normalise_payload("twilio", payload)
        assert fields["status"] == CallStatus.COMPLETED
        assert fields["duration_seconds"] == 42
        assert fields["sequence"] == 4
        # Twilio reports price as a debit; the sign is not information.
        assert fields["cost"] == abs(fields["cost"])
        assert float(fields["cost"]) == pytest.approx(0.013)

    def test_missing_price_is_none_not_zero(self):
        """Zero cost and unknown cost are different facts."""
        fields = normalise_payload("twilio", {"CallStatus": "completed"})
        assert fields["cost"] is None

    def test_unknown_status_maps_to_failed(self):
        fields = normalise_payload("twilio", {"CallStatus": "banana"})
        assert fields["status"] == CallStatus.FAILED

    def test_garbage_numeric_fields_do_not_raise(self):
        fields = normalise_payload(
            "twilio",
            {"CallStatus": "completed", "CallDuration": "n/a",
             "SequenceNumber": "", "Price": "free"},
        )
        assert fields["duration_seconds"] == 0
        assert fields["sequence"] is None
        assert fields["cost"] is None
