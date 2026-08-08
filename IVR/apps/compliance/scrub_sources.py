"""
Reading suppression lists from an external source.

`DECISIONS.md` left the vendor call unimplemented on purpose: the federal DNC
SAN download, the state registries and the litigator vendors each have their
own contract and cadence, and inventing an API client for one of them produces
code that looks like it works.

That reasoning applies to *authentication and scheduling*, not to *parsing*.
Every one of those sources ultimately hands you a file of phone numbers — the
federal SAN as a per-area-code text download, most vendors as CSV or a zip of
CSVs. So this module implements the part that is genuinely common, and leaves
only "where does the file come from and what credential opens it" as config.

Two source kinds, both explicit:

    SCRUB_SOURCE_DIR   a directory the vendor's own downloader drops files in.
                       Preferred: the credential never touches this codebase,
                       and re-running the parse costs nothing.

    SCRUB_SOURCE_URL   an HTTPS URL fetched directly, optionally with a bearer
                       token. May contain {san} and {slug} placeholders, which
                       are filled from the organisation.

If neither is configured, the caller still raises NotImplementedError and the
ScrubJob still records a failure — "when did you last scrub?" keeps its honest
answer rather than silently reporting success against an empty list.
"""

from __future__ import annotations

import csv
import io
import logging
import pathlib
import re
import zipfile

logger = logging.getLogger("ivr.compliance")

#: Column names that plausibly hold the number, in order of preference. A file
#: whose header names none of these falls back to scanning every column.
_PHONE_COLUMNS = (
    "phone", "phone_number", "phonenumber", "number", "msisdn",
    "tn", "telephone", "dnc", "phone_e164", "e164",
)

#: NANP: optional +1, optional punctuation, ten digits. Deliberately strict —
#: a scrub list that accidentally matches order numbers or ZIP codes would
#: suppress real contacts, and an over-suppression is silent.
_NANP = re.compile(r"(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})")

#: Already-normalised international numbers.
_E164 = re.compile(r"\+([1-9]\d{7,14})")

MAX_BYTES = 512 * 1024 * 1024


class ScrubSourceError(RuntimeError):
    """The source was configured but could not be read."""


def normalise(raw: str) -> str | None:
    """
    Return an E.164 number, or None if the token is not plausibly one.

    Returning None rather than guessing matters: a malformed row that got
    coerced into a valid-looking number would suppress somebody else's
    contact, and nothing downstream would ever flag it.
    """
    if not raw:
        return None
    token = raw.strip().strip("\"'")
    if not token:
        return None

    m = _E164.fullmatch(token)
    if m:
        return f"+{m.group(1)}"

    digits_only = re.sub(r"\D", "", token)
    # A bare 10- or 11-digit NANP string is the federal SAN's format.
    if len(digits_only) == 10 and digits_only[0] in "23456789":
        return f"+1{digits_only}"
    if (len(digits_only) == 11 and digits_only.startswith("1")
            and digits_only[1] in "23456789"):
        return f"+{digits_only}"

    m = _NANP.fullmatch(token)
    if m:
        return f"+1{m.group(1)}{m.group(2)}{m.group(3)}"
    return None


def _from_csv(text: str) -> list[str]:
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return []

    header = [c.strip().lower() for c in rows[0]]
    body = rows
    index = None
    for i, name in enumerate(header):
        if name in _PHONE_COLUMNS:
            index, body = i, rows[1:]
            break
    else:
        # No recognisable header. If row 0 parses as a number it is data, not
        # a header — the SAN download has no header line at all.
        if not any(normalise(c) for c in rows[0]):
            body = rows[1:]

    out = []
    for row in body:
        cells = [row[index]] if index is not None and index < len(row) else row
        for cell in cells:
            n = normalise(cell)
            if n:
                out.append(n)
                break
    return out


def _from_text(text: str) -> list[str]:
    out = []
    for line in text.splitlines():
        n = normalise(line)
        if n:
            out.append(n)
    return out


def parse_bytes(data: bytes, *, name: str = "") -> list[str]:
    """Extract E.164 numbers from a csv, txt or zip payload."""
    if data[:2] == b"PK":
        found = []
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for member in zf.namelist():
                if member.endswith("/"):
                    continue
                info = zf.getinfo(member)
                if info.file_size > MAX_BYTES:
                    raise ScrubSourceError(
                        f"{member} expands to {info.file_size} bytes; refusing"
                    )
                found.extend(parse_bytes(zf.read(member), name=member))
        return found

    text = data.decode("utf-8-sig", "replace")
    lowered = name.lower()
    if lowered.endswith(".csv") or ("," in text.split("\n", 1)[0]):
        return _from_csv(text)
    return _from_text(text)


def from_directory(directory: str, *, patterns: list[str]) -> list[str]:
    """
    Read every file in `directory` matching any of `patterns`.

    The vendor's own downloader owns the credential and the schedule; this
    only reads what it left behind.
    """
    root = pathlib.Path(directory).expanduser()
    if not root.is_dir():
        raise ScrubSourceError(f"SCRUB_SOURCE_DIR is not a directory: {root}")

    seen: set[str] = set()
    numbers: list[str] = []
    files = sorted({p for pat in patterns for p in root.glob(pat) if p.is_file()})
    if not files:
        raise ScrubSourceError(
            f"no files in {root} matched {patterns} — the vendor download may "
            f"not have run"
        )
    for path in files:
        if path.stat().st_size > MAX_BYTES:
            raise ScrubSourceError(f"{path} is larger than {MAX_BYTES} bytes")
        for n in parse_bytes(path.read_bytes(), name=path.name):
            if n not in seen:
                seen.add(n)
                numbers.append(n)
    logger.info("scrub source read from disk",
                extra={"files": len(files), "numbers": len(numbers)})
    return numbers


def from_url(url: str, *, token: str = "", timeout: int = 120) -> list[str]:
    """Fetch a single file over HTTPS."""
    import requests

    if not url.startswith("https://"):
        # A suppression list fetched over plaintext can be stripped or altered
        # in transit, and the failure mode is dialling numbers that opted out.
        raise ScrubSourceError("SCRUB_SOURCE_URL must be https")

    headers = {"Authorization": f"Bearer {token}"} if token else {}
    resp = requests.get(url, headers=headers, timeout=timeout, stream=True)
    if resp.status_code != 200:
        raise ScrubSourceError(f"scrub source returned HTTP {resp.status_code}")

    data = io.BytesIO()
    for chunk in resp.iter_content(1 << 20):
        data.write(chunk)
        if data.tell() > MAX_BYTES:
            raise ScrubSourceError(f"scrub source exceeded {MAX_BYTES} bytes")

    name = url.rsplit("/", 1)[-1].split("?")[0]
    numbers = parse_bytes(data.getvalue(), name=name)
    logger.info("scrub source fetched", extra={"numbers": len(numbers)})
    return numbers
