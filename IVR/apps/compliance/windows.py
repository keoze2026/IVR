"""
Calling-window resolution (spec 7.4).

The effective window for a given contact is the **intersection** of three
things, never the union:

  1. the jurisdiction ceiling  (US federal 08:00–21:00 local, by default)
  2. the tenant's CallingWindow row for that jurisdiction, if any
  3. the campaign's own window_start_local / window_end_local

Operators may tighten, never widen (spec 4.4). The intersection is computed on
every check rather than precomputed, because a campaign spanning six timezones
crosses window boundaries continuously while it runs.

A note on what is *not* here: this module does not ship a table of US state
calling-hour restrictions. Several states are stricter than the federal rule
and a wrong entry in a shipped table is worse than no entry, because it reads
as authoritative. State overrides are configured as CallingWindow rows per
tenant after legal review; absent a row, the federal ceiling applies, which is
the safe direction to be wrong in.
"""

from __future__ import annotations

import datetime as dt
import logging
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger("ivr.compliance")

WINDOW_CACHE_TTL = 300


class WindowDecision:
    """Result of a window check. Carries the reason so the pacer can log it."""

    __slots__ = ("allowed", "reason", "next_open_at", "jurisdiction")

    def __init__(self, allowed: bool, reason: str = "",
                 next_open_at: dt.datetime | None = None,
                 jurisdiction: str = ""):
        self.allowed = allowed
        self.reason = reason
        self.next_open_at = next_open_at
        self.jurisdiction = jurisdiction

    def __bool__(self) -> bool:
        return self.allowed

    def __repr__(self):  # pragma: no cover - debugging aid
        return f"<WindowDecision allowed={self.allowed} reason={self.reason!r}>"


def _parse_time(value) -> dt.time:
    if isinstance(value, dt.time):
        return value
    hour, _, minute = str(value).partition(":")
    return dt.time(int(hour), int(minute or 0))


def contact_timezone(contact, campaign) -> ZoneInfo:
    """
    Which clock governs this contact.

    Falls back to UTC rather than to the server's timezone: a silent fallback
    to America/New_York would let a European number be dialled at 03:00 local.
    """
    if not campaign.respect_contact_timezone:
        return ZoneInfo(campaign.fallback_timezone or "UTC")
    name = (contact.timezone or "").strip() or "UTC"
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning("unknown contact timezone, falling back to UTC",
                       extra={"tz": name})
        return ZoneInfo("UTC")


def resolve_jurisdiction(contact) -> str:
    """
    Jurisdiction key for a contact: "US", "US-FL", "KE", …

    US numbers resolve to a state when the NPA table has been loaded; without
    it they resolve to "US" and get the federal ceiling.
    """
    country = (contact.country_code or "").strip()
    if country == "1" or (contact.phone_e164 or "").startswith("+1"):
        state = _state_for_npa(contact.phone_e164)
        return f"US-{state}" if state else "US"
    return _iso_country(country)


def _state_for_npa(e164: str) -> str:
    if not e164 or not e164.startswith("+1") or len(e164) < 5:
        return ""
    npa = e164[2:5]
    key = f"npa:{npa}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    from apps.compliance.models import NpaJurisdiction

    state = (
        NpaJurisdiction.objects.filter(npa=npa)
        .values_list("state", flat=True)
        .first()
        or ""
    )
    cache.set(key, state, 3600)
    return state


#: Minimal calling-code → ISO country mapping for the jurisdictions this
#: platform is expected to dial. Anything unmapped resolves to the numeric
#: calling code, which will not match a CallingWindow row and therefore falls
#: back to the campaign window alone.
_CC_TO_ISO = {
    "1": "US", "44": "GB", "254": "KE", "255": "TZ", "256": "UG",
    "234": "NG", "27": "ZA", "233": "GH", "91": "IN", "61": "AU",
}


def _iso_country(calling_code: str) -> str:
    return _CC_TO_ISO.get(calling_code, calling_code or "??")


def jurisdiction_window(org_id, jurisdiction: str):
    """
    The tenant's configured window for a jurisdiction, most specific first:
    "US-FL" then "US". Returns None when nothing is configured.
    """
    key = f"window:{org_id}:{jurisdiction}"
    cached = cache.get(key)
    if cached is not None:
        return cached or None

    from apps.compliance.models import CallingWindow

    candidates = [jurisdiction]
    if "-" in jurisdiction:
        candidates.append(jurisdiction.split("-", 1)[0])

    rows = {
        w.jurisdiction: w
        for w in CallingWindow.objects.unscoped().filter(
            organization_id=org_id, jurisdiction__in=candidates
        )
    }
    window = next((rows[c] for c in candidates if c in rows), None)
    payload = (
        {
            "start": window.start_local.isoformat(),
            "end": window.end_local.isoformat(),
            "weekdays": window.weekdays,
            "holidays_blocked": window.holidays_blocked,
        }
        if window
        else {}
    )
    cache.set(key, payload, WINDOW_CACHE_TTL)
    return payload or None


def federal_ceiling(jurisdiction: str) -> tuple[dt.time, dt.time] | None:
    """Statutory ceiling applied regardless of tenant configuration."""
    if jurisdiction == "US" or jurisdiction.startswith("US-"):
        return (
            _parse_time(settings.US_FEDERAL_WINDOW_START),
            _parse_time(settings.US_FEDERAL_WINDOW_END),
        )
    return None


def effective_window(campaign, contact) -> tuple[dt.time, dt.time, set[int], bool, str]:
    """
    Intersect campaign, tenant and statutory windows.

    Returns (start, end, allowed_weekdays, holidays_blocked, jurisdiction).
    An empty weekday set or start >= end means "never dialable today".
    """
    jurisdiction = resolve_jurisdiction(contact)

    start = _parse_time(campaign.window_start_local)
    end = _parse_time(campaign.window_end_local)
    weekdays = set(campaign.active_weekdays or range(7))
    holidays_blocked = True

    tenant = jurisdiction_window(campaign.organization_id, jurisdiction)
    if tenant:
        start = max(start, _parse_time(tenant["start"]))
        end = min(end, _parse_time(tenant["end"]))
        if tenant["weekdays"]:
            weekdays &= set(tenant["weekdays"])
        holidays_blocked = tenant["holidays_blocked"]

    ceiling = federal_ceiling(jurisdiction)
    if ceiling:
        start = max(start, ceiling[0])
        end = min(end, ceiling[1])

    return start, end, weekdays, holidays_blocked, jurisdiction


def is_within_window(campaign, contact, now: dt.datetime | None = None) -> WindowDecision:
    """The authoritative per-contact window check, run in the pacer."""
    now = now or timezone.now()
    tz = contact_timezone(contact, campaign)
    local = now.astimezone(tz)

    start, end, weekdays, holidays_blocked, jurisdiction = effective_window(
        campaign, contact
    )

    if start >= end:
        return WindowDecision(False, "window_empty", jurisdiction=jurisdiction)

    if local.weekday() not in weekdays:
        return WindowDecision(
            False,
            "weekday_excluded",
            next_open_at=_next_open(local, tz, start, weekdays),
            jurisdiction=jurisdiction,
        )

    if holidays_blocked and _is_holiday(local.date(), jurisdiction):
        return WindowDecision(
            False,
            "holiday",
            next_open_at=_next_open(local, tz, start, weekdays),
            jurisdiction=jurisdiction,
        )

    if not (start <= local.time() < end):
        return WindowDecision(
            False,
            "outside_hours",
            next_open_at=_next_open(local, tz, start, weekdays),
            jurisdiction=jurisdiction,
        )

    return WindowDecision(True, jurisdiction=jurisdiction)


def _next_open(local: dt.datetime, tz: ZoneInfo, start: dt.time,
               weekdays: set[int]) -> dt.datetime | None:
    """When this contact next becomes dialable, for retry scheduling."""
    if not weekdays:
        return None
    candidate = local
    if local.time() >= start:
        candidate = local + dt.timedelta(days=1)
    for _ in range(8):
        if candidate.weekday() in weekdays:
            return candidate.replace(
                hour=start.hour, minute=start.minute, second=0, microsecond=0
            ).astimezone(dt.UTC)
        candidate += dt.timedelta(days=1)
    return None


def _is_holiday(day: dt.date, jurisdiction: str) -> bool:
    country = jurisdiction.split("-", 1)[0]
    subdiv = jurisdiction.split("-", 1)[1] if "-" in jurisdiction else None
    try:
        import holidays as holidays_lib
    except ImportError:  # pragma: no cover - optional dependency
        return False
    key = f"holidays:{jurisdiction}:{day.year}"
    dates = cache.get(key)
    if dates is None:
        try:
            cal = holidays_lib.country_holidays(
                country, subdiv=subdiv, years=[day.year]
            )
            dates = {d.isoformat() for d in cal}
        except (KeyError, NotImplementedError):
            dates = set()
        cache.set(key, dates, 86_400)
    return day.isoformat() in dates


def campaign_has_open_window(campaign, now: dt.datetime | None = None) -> bool:
    """
    Cheap campaign-level pre-check for the pacer.

    If the campaign's own window is closed in *every* timezone its contacts
    could plausibly be in, there is no point claiming rows at all. This is an
    optimisation, not a control — the per-contact check still runs.
    """
    now = now or timezone.now()
    weekdays = set(campaign.active_weekdays or range(7))
    start = _parse_time(campaign.window_start_local)
    end = _parse_time(campaign.window_end_local)
    if start >= end:
        return False
    # UTC-12 … UTC+14 covers every inhabited offset.
    for offset in range(-12, 15):
        local = now.astimezone(dt.timezone(dt.timedelta(hours=offset)))
        if local.weekday() in weekdays and start <= local.time() < end:
            return True
    return False
