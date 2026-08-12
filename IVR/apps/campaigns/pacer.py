"""
The pacer (spec 7.3).

The pacer is the only component that decides whether a call may be placed.
Dispatch workers are dumb executors. Keeping the decision in one place is what
lets dispatch scale horizontally without multiplying the rate limit, and it
means there is exactly one function to read when asking "why did we dial that?"

Per tick, per campaign:

    live      = semaphore.live()
    headroom  = max_channels - live
    tokens    = bucket.take(min(headroom, per_tick_cap))
    rows      = claim(tokens)            # SELECT … FOR UPDATE SKIP LOCKED
    for row in rows: semaphore.acquire(row) and dispatch(row)

Order matters. Channel headroom is computed first because it is the cheaper
check and the one that is usually binding; tokens are only consumed for calls
there is actually room to place, so a campaign sitting at its channel ceiling
does not silently burn its CPS allowance.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.common.enums import CampaignStatus, QueueState
from apps.common.redis_clients import Keys, counters_redis
from apps.dialer.limits import ChannelSemaphore, TokenBucket

logger = logging.getLogger("ivr.dialer")

#: Never claim more than this in one tick regardless of configuration. Bounds
#: the row lock held by any single pacer run.
MAX_BATCH = 200

#: How long one pace_campaign run may hold its lock. Longer than a normal run
#: by an order of magnitude, short enough that a wedged worker frees it fast.
LOCK_TTL_SECONDS = 5


def _dial_mode_allowance(campaign, headroom: int) -> int:
    """
    How many calls this dial mode permits this tick, before pacing and headroom.

    The three modes differ only in *when* calls leave, never in the limits:
    cps_limit and the channel ceiling still bind underneath all of them.

      fixed  no extra metering — fill to the ceiling as fast as the token
             bucket allows.

      pulse  one batch of `dial_batch_size` at the start of each
             `dial_interval_seconds` window, then nothing until the next. A
             NX key with the interval as its TTL is the whole mechanism: the
             first tick of a window sets it and gets the batch; every later
             tick in that window finds it set and gets zero.

      ramp   the same batch per window, but released at scattered moments
             rather than all on the beat. Each tick has a batch/interval chance
             of letting one call out, and a per-window counter caps the total
             so a run of lucky ticks cannot exceed the batch.
    """
    from apps.common.redis_clients import counters_redis

    mode = getattr(campaign, "dial_mode", "fixed")
    if mode == "fixed":
        return headroom

    batch = max(1, int(campaign.dial_batch_size or 1))
    interval = max(1, int(campaign.dial_interval_seconds or 1))
    r = counters_redis()

    if mode == "pulse":
        gate = f"pace:pulse:{campaign.pk}"
        # set(nx, ex) is atomic: exactly one tick per window wins it.
        if r.set(gate, 1, nx=True, ex=interval):
            return batch
        return 0

    if mode == "ramp":
        import random

        counter = f"pace:ramp:{campaign.pk}"
        # Open the window on its first tick and stamp its lifetime once, so the
        # count resets cleanly when the interval elapses.
        if r.set(counter, 0, nx=True, ex=interval):
            pass
        sent = int(r.get(counter) or 0)
        if sent >= batch:
            return 0
        # Expected `batch` releases spread across `interval` ticks.
        if random.random() < batch / interval:  # noqa: S311 - jitter, not a secret
            r.incr(counter)
            return 1
        return 0

    return headroom


def pace(campaign) -> dict:
    """Run one pacing tick for one campaign. Returns a small report for logs."""
    report = {
        "campaign": str(campaign.pk),
        "claimed": 0,
        "dispatched": 0,
        "reason": "",
    }

    if campaign.status != CampaignStatus.RUNNING:
        report["reason"] = "not_running"
        return report

    if campaign.organization.is_suspended:
        report["reason"] = "org_suspended"
        return report

    # Cheap campaign-level window check. The authoritative per-contact check
    # happens in the dispatch task, because contacts in one campaign can sit in
    # a dozen timezones.
    from apps.compliance.windows import campaign_has_open_window

    if not campaign_has_open_window(campaign):
        report["reason"] = "window_closed_everywhere"
        return report

    semaphore = ChannelSemaphore(campaign.pk, campaign.effective_channels())
    headroom = semaphore.available()
    if headroom <= 0:
        report["reason"] = "no_channel_headroom"
        return report

    # How many the dial mode wants to release this tick. Fixed says "as many as
    # pacing allows"; pulse and ramp meter the batch out over the interval.
    mode_cap = _dial_mode_allowance(campaign, headroom)
    if mode_cap <= 0:
        report["reason"] = "mode_waiting"
        return report

    cps = campaign.effective_cps()
    # One tick is one second, so the per-tick ceiling is the CPS itself, with a
    # floor of 1 so that sub-1-CPS campaigns still make progress (the bucket
    # will simply grant 0 on most ticks).
    per_tick_cap = max(1, int(cps + 0.999))
    want = min(headroom, per_tick_cap, MAX_BATCH, mode_cap)

    bucket = TokenBucket(Keys.token_bucket(campaign.pk), cps)
    granted = bucket.take(want)
    if granted <= 0:
        report["reason"] = "no_tokens"
        return report

    rows = claim_rows(campaign, granted)
    report["claimed"] = len(rows)
    if not rows:
        report["reason"] = "queue_empty"
        maybe_complete(campaign)
        return report

    from apps.dialer.tasks import place_call

    dispatched = 0
    released = []
    for row_id in rows:
        member = str(row_id)
        if not semaphore.acquire(member):
            # Someone else filled the last channels between our headroom read
            # and now. Return the rest of the batch to the queue.
            released.append(row_id)
            continue
        place_call.apply_async(args=[str(row_id), member], queue="dispatch")
        dispatched += 1

    if released:
        release_rows(released)

    report["dispatched"] = dispatched
    return report


def claim_rows(campaign, limit: int) -> list:
    """
    Claim up to `limit` queue rows.

    SELECT … FOR UPDATE SKIP LOCKED is what makes multiple pacer processes
    safe: two ticks racing on the same campaign take disjoint row sets instead
    of blocking on each other or double-dialling.
    """
    from apps.campaigns.models import CampaignContact

    now = timezone.now()
    with transaction.atomic():
        claimable = (
            CampaignContact.objects.unscoped()
            # of=("self",) matters: the filter joins contacts, and without it
            # Postgres would take row locks on contact rows too — blocking
            # every other campaign that happens to target the same people.
            .select_for_update(skip_locked=True, of=("self",))
            .filter(
                campaign=campaign,
                state=QueueState.PENDING,
                contact__is_suppressed=False,
            )
            .filter(Q(next_attempt_at__isnull=True) | Q(next_attempt_at__lte=now))
            .order_by("priority", "next_attempt_at", "id")
            .values_list("id", flat=True)[:limit]
        )
        row_ids = list(claimable)
        if row_ids:
            CampaignContact.objects.unscoped().filter(id__in=row_ids).update(
                state=QueueState.DIALING, claimed_at=now
            )
    return row_ids


def release_rows(row_ids: list) -> None:
    from apps.campaigns.models import CampaignContact

    CampaignContact.objects.unscoped().filter(id__in=row_ids).update(
        state=QueueState.PENDING, claimed_at=None
    )


def maybe_complete(campaign) -> bool:
    """
    Mark a campaign completed once nothing is left to do.

    "Queue empty" is not sufficient: rows awaiting a retry have a future
    next_attempt_at and are legitimately not claimable yet, and calls still in
    flight have not produced their dispositions. A campaign is done when no row
    is pending or dialling and no channel is live.
    """
    from apps.campaigns.models import Campaign, CampaignContact

    outstanding = (
        CampaignContact.objects.unscoped()
        .filter(campaign=campaign,
                state__in=[QueueState.PENDING, QueueState.DIALING])
        .exists()
    )
    if outstanding:
        return False

    semaphore = ChannelSemaphore(campaign.pk, campaign.effective_channels())
    if semaphore.live() > 0:
        return False

    updated = Campaign.objects.unscoped().filter(
        pk=campaign.pk, status=CampaignStatus.RUNNING
    ).update(status=CampaignStatus.COMPLETED, completed_at=timezone.now())

    if updated:
        from apps.telemetry.tasks import flush_campaign_counters

        flush_campaign_counters.delay(str(campaign.pk))
        logger.info("campaign completed", extra={"campaign": str(campaign.pk)})
    return bool(updated)


# ---------------------------------------------------------------------------
# Locking
# ---------------------------------------------------------------------------
def acquire_tick_lock(campaign_id) -> bool:
    """
    One pacing run per campaign at a time.

    Beat can double-fire across a scheduler failover, and a slow tick must not
    overlap the next one — two concurrent ticks would each see the same channel
    headroom and collectively dispatch twice the intended batch.
    """
    try:
        return bool(
            counters_redis().set(
                Keys.campaign_lock(campaign_id), "1", nx=True, ex=LOCK_TTL_SECONDS
            )
        )
    except Exception:  # noqa: BLE001 - Redis down means do not dial
        logger.exception("failed to acquire pacer lock")
        return False


def release_tick_lock(campaign_id) -> None:
    try:
        counters_redis().delete(Keys.campaign_lock(campaign_id))
    except Exception:  # noqa: BLE001
        # The lock has a 5s TTL, so a failed release costs at most one skipped
        # tick. Logged rather than ignored so a persistent Redis problem is
        # visible before it starts costing throughput.
        logger.warning("failed to release pacer lock",
                       extra={"campaign": str(campaign_id)})
