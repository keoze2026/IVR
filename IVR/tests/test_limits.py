"""
Token bucket and channel semaphore (spec 7.1).

These are the two controls standing between a misconfiguration and a suspended
carrier account, so they are tested against a real Redis implementation
(fakeredis executes the Lua) rather than against a mock.
"""

import time

import pytest

from apps.dialer.limits import ChannelSemaphore, TokenBucket


class TestTokenBucket:
    def test_grants_up_to_capacity_then_denies(self, fake_redis):
        bucket = TokenBucket("tb:test", rate=5.0)
        assert bucket.take(5) == 5
        assert bucket.take(1) == 0

    def test_partial_grant_when_short(self, fake_redis):
        bucket = TokenBucket("tb:test", rate=3.0)
        assert bucket.take(10) == 3

    def test_refills_over_time(self, fake_redis):
        bucket = TokenBucket("tb:test", rate=10.0)
        assert bucket.take(10) == 10
        assert bucket.take(1) == 0
        time.sleep(0.35)
        # ~3 tokens should have accrued at 10/s.
        assert bucket.take(5) >= 2

    def test_burst_is_bounded_by_capacity(self, fake_redis):
        """A bucket idle for a long time must not dump a huge burst."""
        bucket = TokenBucket("tb:test", rate=2.0)
        time.sleep(0.2)
        # Capacity defaults to one second of rate, so at most 2 regardless of
        # how long it sat idle.
        assert bucket.take(100) <= 2

    def test_zero_rate_never_grants(self, fake_redis):
        assert TokenBucket("tb:test", rate=0.0).take(5) == 0

    def test_denies_when_redis_unavailable(self, monkeypatch):
        """Failure posture: if we cannot verify the limit, we do not dial."""
        from redis.exceptions import ConnectionError as RedisConnectionError

        from apps.dialer import limits

        def boom():
            raise RedisConnectionError("down")

        monkeypatch.setattr(limits, "counters_redis", boom)
        assert TokenBucket("tb:test", rate=100.0).take(10) == 0

    def test_separate_keys_do_not_interfere(self, fake_redis):
        a, b = TokenBucket("tb:a", rate=2.0), TokenBucket("tb:b", rate=2.0)
        assert a.take(2) == 2
        assert b.take(2) == 2


class TestChannelSemaphore:
    def test_acquires_up_to_limit(self, fake_redis):
        sem = ChannelSemaphore("camp-1", limit=3)
        assert all(sem.acquire(f"call-{i}") for i in range(3))
        assert sem.acquire("call-4") is False
        assert sem.live() == 3

    def test_release_frees_a_slot(self, fake_redis):
        sem = ChannelSemaphore("camp-1", limit=1)
        assert sem.acquire("call-1")
        assert sem.acquire("call-2") is False
        sem.release("call-1")
        assert sem.acquire("call-2")

    def test_reacquiring_same_member_is_not_double_counted(self, fake_redis):
        """A retried dispatch must not consume two channels for one call."""
        sem = ChannelSemaphore("camp-1", limit=2)
        sem.acquire("call-1")
        sem.acquire("call-1")
        assert sem.live() == 1

    def test_rename_preserves_the_reservation(self, fake_redis):
        """Re-keying from queue row to call SID must not free the channel."""
        sem = ChannelSemaphore("camp-1", limit=1)
        sem.acquire("row-1")
        sem.rename("row-1", "CA123")
        assert sem.live() == 1
        assert sem.members() == ["CA123"]
        assert sem.acquire("row-2") is False

    def test_reconcile_removes_leaked_entries(self, fake_redis):
        sem = ChannelSemaphore("camp-1", limit=10)
        for sid in ("CA1", "CA2", "CA3"):
            sem.acquire(sid)
        leaked = sem.reconcile({"CA1"})
        assert leaked == 2
        assert sem.live() == 1

    def test_reconcile_adds_missing_entries(self, fake_redis):
        """Ground truth wins in both directions."""
        sem = ChannelSemaphore("camp-1", limit=10)
        sem.acquire("CA1")
        sem.reconcile({"CA1", "CA2"})
        assert sem.live() == 2

    def test_reports_saturated_when_redis_is_down(self, monkeypatch):
        from redis.exceptions import ConnectionError as RedisConnectionError

        from apps.dialer import limits

        def boom():
            raise RedisConnectionError("down")

        monkeypatch.setattr(limits, "counters_redis", boom)
        sem = ChannelSemaphore("camp-1", limit=5)
        assert sem.live() == 5
        assert sem.available() == 0
        assert sem.acquire("call-1") is False


@pytest.mark.parametrize("limit", [1, 5, 30])
def test_semaphore_never_exceeds_limit_under_contention(fake_redis, limit):
    """The property that actually matters: the ceiling is never breached."""
    sem = ChannelSemaphore("camp-x", limit=limit)
    granted = sum(1 for i in range(limit * 3) if sem.acquire(f"c-{i}"))
    assert granted == limit
    assert sem.live() == limit
