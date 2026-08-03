#!/usr/bin/env python
"""
Load harness for the two components that decide throughput.

Nothing here talks to a carrier, so it can run against a laptop. What it
measures is the ceiling the rest of the system is dialling against:

  limiter   the Redis token bucket and channel semaphore under real thread
            contention. These are Lua scripts executed server-side, so the
            number this prints is the actual grant rate a pacer can expect —
            not a simulation of one.

  events    the status-callback ingest path, which DECISIONS.md names as the
            first queue that will fall behind: four callbacks per call at
            20 CPS is 80/s sustained. Needs a running web process.

Usage:
    python scripts/loadtest.py limiter --rate 20 --workers 32 --seconds 10
    python scripts/loadtest.py limiter --channels 30 --workers 64
    python scripts/loadtest.py events  --url http://127.0.0.1:8000 --rps 80 --seconds 15

Exit status is 1 if a measured value contradicts a configured one — a bucket
granting above its rate, or a semaphore exceeding its ceiling. Those are
correctness failures that only appear under contention.
"""

import argparse
import os
import statistics
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import django

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
django.setup()

from apps.dialer.limits import ChannelSemaphore, TokenBucket  # noqa: E402


def _pct(values, p):
    if not values:
        return 0.0
    values = sorted(values)
    k = min(len(values) - 1, int(round((p / 100.0) * (len(values) - 1))))
    return values[k]


def _report(name, latencies, elapsed, count):
    rate = count / elapsed if elapsed else 0
    print(f"\n  {name}")
    print(f"    operations     {count} in {elapsed:.2f}s  ({rate:.1f}/s)")
    if latencies:
        print(f"    latency  mean  {statistics.mean(latencies) * 1000:.2f} ms")
        print(f"             p50   {_pct(latencies, 50) * 1000:.2f} ms")
        print(f"             p95   {_pct(latencies, 95) * 1000:.2f} ms")
        print(f"             p99   {_pct(latencies, 99) * 1000:.2f} ms")
        print(f"             max   {max(latencies) * 1000:.2f} ms")


# ---------------------------------------------------------------------------
def bench_bucket(rate, workers, seconds):
    """Hammer one bucket from N threads; granted/s must not exceed `rate`."""
    key = f"loadtest:bucket:{uuid.uuid4().hex[:8]}"
    bucket = TokenBucket(key, rate=rate, capacity=rate)
    bucket.reset()

    granted = denied = 0
    lock = threading.Lock()
    latencies = []
    stop = time.monotonic() + seconds

    def worker():
        nonlocal granted, denied
        local_lat = []
        g = d = 0
        while time.monotonic() < stop:
            t0 = time.perf_counter()
            n = bucket.take(1)
            local_lat.append(time.perf_counter() - t0)
            if n:
                g += 1
            else:
                d += 1
                time.sleep(0.002)  # a real pacer backs off rather than spinning
        with lock:
            granted += g
            denied += d
            latencies.extend(local_lat)

    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for _ in range(workers):
            pool.submit(worker)
    elapsed = time.monotonic() - t0

    _report(f"token bucket — rate={rate}/s, {workers} threads", latencies, elapsed,
            granted + denied)
    observed = granted / elapsed
    print(f"    granted        {granted}  ({observed:.2f}/s)")
    print(f"    denied         {denied}")

    # The bucket starts full, so a burst of `capacity` on top of rate*elapsed is
    # correct behaviour, not a violation. Anything beyond that is a real fault.
    ceiling = rate * elapsed + rate
    if granted > ceiling:
        print(f"    \033[31mFAIL\033[0m granted {granted} exceeds ceiling {ceiling:.0f}")
        return False
    print(f"    \033[32mOK\033[0m   within ceiling ({ceiling:.0f})")
    bucket.reset()
    return True


def bench_semaphore(limit, workers, seconds):
    """Acquire/release churn; live count must never exceed the ceiling."""
    campaign_id = f"loadtest-{uuid.uuid4().hex[:8]}"
    sem = ChannelSemaphore(campaign_id, limit=limit)
    sem.clear()

    acquired = rejected = 0
    peak = 0
    lock = threading.Lock()
    latencies = []
    stop = time.monotonic() + seconds

    def worker(wid):
        nonlocal acquired, rejected, peak
        a = r = 0
        local_lat = []
        i = 0
        while time.monotonic() < stop:
            member = f"sid-{wid}-{i}"
            i += 1
            t0 = time.perf_counter()
            got = sem.acquire(member)
            local_lat.append(time.perf_counter() - t0)
            if got:
                a += 1
                live = sem.live()
                with lock:
                    peak = max(peak, live)
                sem.release(member)
            else:
                r += 1
        with lock:
            acquired += a
            rejected += r
            latencies.extend(local_lat)

    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for w in range(workers):
            pool.submit(worker, w)
    elapsed = time.monotonic() - t0

    _report(f"channel semaphore — limit={limit}, {workers} threads", latencies,
            elapsed, acquired + rejected)
    print(f"    acquired       {acquired}")
    print(f"    rejected       {rejected}")
    print(f"    peak live      {peak} (ceiling {limit})")

    leaked = sem.live()
    sem.clear()
    if peak > limit:
        print(f"    \033[31mFAIL\033[0m peak {peak} exceeded ceiling {limit}")
        return False
    if leaked:
        print(f"    \033[31mFAIL\033[0m {leaked} channel(s) leaked after release")
        return False
    print("    \033[32mOK\033[0m   ceiling held, nothing leaked")
    return True


# ---------------------------------------------------------------------------
def bench_events(base_url, rps, seconds, workers):
    """
    Drive signed status callbacks at a fixed rate against a running web process.

    Unsigned requests are rejected before any work happens, which would measure
    the 403 path rather than ingest. So this signs each request the way the
    carrier does, using the same token the app verifies with.
    """
    import base64
    import hashlib
    import hmac

    import requests
    from django.conf import settings

    token = getattr(settings, "TWILIO_AUTH_TOKEN", "") or os.environ.get(
        "TWILIO_AUTH_TOKEN", ""
    )
    if not token:
        print("  TWILIO_AUTH_TOKEN is not set — every request would 403 and the\n"
              "  number would measure signature rejection, not ingest. Set it to\n"
              "  any value and set the same one in the server's environment.")
        return False

    path = "/webhooks/twilio/status/"
    url = f"{base_url.rstrip('/')}{path}"

    # signatures.signed_url rebuilds the signed URL from PUBLIC_BASE_URL, not
    # from the Host header — so the signature has to be computed against that
    # value even though the request is posted to localhost. Signing the real
    # target URL instead is what makes every webhook 403, and it is the first
    # thing the README tells you to check.
    from django.conf import settings as _s

    sign_url = f"{_s.PUBLIC_BASE_URL.rstrip('/')}{path}"
    if sign_url != url:
        print(f"    signing against PUBLIC_BASE_URL: {sign_url}")

    def sign(params):
        payload = sign_url + "".join(f"{k}{params[k]}" for k in sorted(params))
        mac = hmac.new(token.encode(), payload.encode(), hashlib.sha1).digest()
        return base64.b64encode(mac).decode()

    latencies, codes = [], {}
    lock = threading.Lock()
    stop = time.monotonic() + seconds
    interval = 1.0 / rps if rps else 0

    def worker(wid):
        session = requests.Session()
        local_lat, local_codes = [], {}
        while time.monotonic() < stop:
            params = {
                "CallSid": f"CA{uuid.uuid4().hex}",
                "CallStatus": "completed",
                "CallDuration": "31",
                "To": "+15005550006",
                "From": "+15005550001",
            }
            t0 = time.perf_counter()
            try:
                r = session.post(url, data=params,
                                 headers={"X-Twilio-Signature": sign(params)},
                                 timeout=10)
                code = r.status_code
            except Exception as exc:  # noqa: BLE001
                code = type(exc).__name__
            local_lat.append(time.perf_counter() - t0)
            local_codes[code] = local_codes.get(code, 0) + 1
            target = t0 + interval * workers
            slack = target - time.perf_counter()
            if slack > 0:
                time.sleep(slack)
        with lock:
            latencies.extend(local_lat)
            for k, v in local_codes.items():
                codes[k] = codes.get(k, 0) + v

    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for w in range(workers):
            pool.submit(worker, w)
    elapsed = time.monotonic() - t0

    total = sum(codes.values())
    _report(f"status-callback ingest — target {rps}/s, {workers} threads",
            latencies, elapsed, total)
    print(f"    responses      {dict(sorted(codes.items(), key=str))}")
    achieved = total / elapsed if elapsed else 0
    print(f"    achieved       {achieved:.1f}/s of {rps}/s target")

    ok = codes.get(200, 0) + codes.get(204, 0) == total
    if not ok:
        print("    \033[31mFAIL\033[0m not every callback was accepted")
        return False
    if achieved < rps * 0.9:
        print("    \033[31mFAIL\033[0m fell short of target rate")
        return False
    print("    \033[32mOK\033[0m   sustained target rate, all accepted")
    return True


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)

    lim = sub.add_parser("limiter", help="token bucket + channel semaphore (Redis only)")
    lim.add_argument("--rate", type=float, default=20.0)
    lim.add_argument("--channels", type=int, default=30)
    lim.add_argument("--workers", type=int, default=32)
    lim.add_argument("--seconds", type=float, default=10.0)

    ev = sub.add_parser("events", help="status-callback ingest (needs a web process)")
    ev.add_argument("--url", default="http://127.0.0.1:8000")
    ev.add_argument("--rps", type=int, default=80)
    ev.add_argument("--seconds", type=float, default=15.0)
    ev.add_argument("--workers", type=int, default=16)

    a = ap.parse_args()
    print(f"\n\033[1mload harness — {a.mode}\033[0m")

    if a.mode == "limiter":
        ok = bench_bucket(a.rate, a.workers, a.seconds)
        ok = bench_semaphore(a.channels, a.workers, a.seconds) and ok
    else:
        ok = bench_events(a.url, a.rps, a.seconds, a.workers)

    print()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
