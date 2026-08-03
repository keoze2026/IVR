"""
Row-level normalisation and validation (spec 5.2).

Everything here is pure: no database, no network. That makes the whole
validation surface unit-testable without fixtures and lets the ingest task
parallelise chunks without shared state.
"""

from __future__ import annotations

import csv
import io

import phonenumbers
from django.conf import settings
from phonenumbers import NumberParseException, PhoneNumberFormat
from phonenumbers import timezone as pn_timezone
from phonenumbers.phonenumberutil import PhoneNumberType, number_type

from apps.common.utils import phone_hash  # noqa: F401  (re-exported; spec 5.2)

REQUIRED_COLUMNS = {"phone"}
RESERVED = {"phone", "first_name", "last_name", "timezone", "country"}

#: Longest a merge variable may be. Prompt text is rendered to speech and read
#: aloud; a 4 KB "variable" is either an error or an attack on the TTS bill.
MAX_VARIABLE_LENGTH = 256
MAX_VARIABLES_PER_ROW = 40

_LINE_TYPE = {
    PhoneNumberType.MOBILE: "mobile",
    PhoneNumberType.FIXED_LINE: "landline",
    PhoneNumberType.FIXED_LINE_OR_MOBILE: "unknown",
    PhoneNumberType.VOIP: "voip",
    PhoneNumberType.TOLL_FREE: "toll_free",
    PhoneNumberType.PREMIUM_RATE: "premium",
}


class RowError(Exception):
    pass


def normalise_phone(raw: str, default_region: str) -> tuple[str, str, str]:
    """Return (e164, country_code, timezone). Raises RowError on invalid input."""
    try:
        num = phonenumbers.parse(raw, default_region)
    except NumberParseException as exc:
        raise RowError(f"unparseable: {exc}") from exc

    if not phonenumbers.is_valid_number(num):
        raise RowError("not a valid number for its region")

    e164 = phonenumbers.format_number(num, PhoneNumberFormat.E164)
    if len(e164) > 16:
        raise RowError("exceeds E.164 length")

    tzs = pn_timezone.time_zones_for_number(num)
    tz = tzs[0] if tzs else "UTC"
    return e164, str(num.country_code), tz


def offline_line_type(e164: str) -> str:
    """
    Best-effort line type from the phonenumbers metadata.

    This is not a substitute for a carrier lookup — number portability means
    metadata cannot tell you whether a given US number is currently wireless.
    It is used to pre-flag obvious premium/toll-free rows at ingest; the
    authoritative value comes from the batched lookup API (spec 5.1 stage 3).
    """
    try:
        num = phonenumbers.parse(e164, None)
    except NumberParseException:
        return ""
    return _LINE_TYPE.get(number_type(num), "unknown")


def parse_row(row: dict, default_region: str) -> dict:
    raw = (row.get("phone") or "").strip()
    if not raw:
        raise RowError("missing phone")

    e164, cc, tz = normalise_phone(raw, default_region)

    variables = {
        k.strip(): (v or "").strip()
        for k, v in row.items()
        if k and k.strip().lower() not in RESERVED
    }
    if len(variables) > MAX_VARIABLES_PER_ROW:
        raise RowError(f"more than {MAX_VARIABLES_PER_ROW} merge variables")
    # Guard against prompt-injection style payloads landing in TTS text
    for k, v in variables.items():
        if len(v) > MAX_VARIABLE_LENGTH:
            raise RowError(f"variable '{k}' exceeds {MAX_VARIABLE_LENGTH} chars")

    return {
        "phone_e164": e164,
        "phone_hash": phone_hash(e164),
        "country_code": cc,
        "timezone": (row.get("timezone") or "").strip() or tz,
        "line_type": offline_line_type(e164),
        "first_name": (row.get("first_name") or "").strip()[:80],
        "last_name": (row.get("last_name") or "").strip()[:80],
        "variables": variables,
    }


def validate_header(fieldnames) -> None:
    if not fieldnames:
        raise RowError("file has no header row")
    lowered = {(name or "").strip().lower() for name in fieldnames}
    missing = REQUIRED_COLUMNS - lowered
    if missing:
        raise RowError(f"missing required column(s): {', '.join(sorted(missing))}")


def iter_rows(line_iter):
    """
    Yield (line_number, row_dict) from an iterator of raw CSV lines.

    Header names are lower-cased and stripped so that "Phone", " phone " and
    "PHONE" all resolve.
    """
    reader = csv.DictReader(_normalising_lines(line_iter))
    validate_header(reader.fieldnames)
    for lineno, row in enumerate(reader, start=2):
        yield lineno, {(k or "").strip().lower(): v for k, v in row.items()}


def _normalising_lines(line_iter):
    first = True
    for line in line_iter:
        if first:
            first = False
            yield line.lower() if _looks_like_header(line) else line
        else:
            yield line


def _looks_like_header(line: str) -> bool:
    return "phone" in line.lower()


def rejects_to_csv(rejects: list[dict]) -> bytes:
    """Serialise rejected rows for operator download."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["line", "reason", "raw"])
    for item in rejects:
        writer.writerow([item.get("line"), item.get("reason"), item.get("raw")])
    return buf.getvalue().encode("utf-8")


def default_region_for(contact_list) -> str:
    return contact_list.default_region or settings.DEFAULT_REGION
