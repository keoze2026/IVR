"""
Structured logging.

Phone numbers are PII in every jurisdiction this platform touches. The
formatter redacts anything that looks like an E.164 number down to its last
four digits so that a stray ``logger.info(contact.phone_e164)`` cannot turn the
log aggregator into an unmanaged copy of the contact database.
"""

import json
import logging
import re

E164_RE = re.compile(r"\+\d{7,15}")

_RESERVED = {
    "args", "asctime", "created", "exc_info", "exc_text", "filename", "funcName",
    "levelname", "levelno", "lineno", "module", "msecs", "message", "msg", "name",
    "pathname", "process", "processName", "relativeCreated", "stack_info",
    "thread", "threadName", "taskName",
}


def redact_phone(value: str) -> str:
    return E164_RE.sub(lambda m: f"+***{m.group(0)[-4:]}", value)


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_phone(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = redact_phone(value) if isinstance(value, str) else value
        if record.exc_info:
            payload["exc"] = redact_phone(self.formatException(record.exc_info))
        return json.dumps(payload, default=str)
