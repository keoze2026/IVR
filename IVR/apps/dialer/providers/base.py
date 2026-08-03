"""Provider adapter interface and shared value objects."""

from __future__ import annotations

from dataclasses import dataclass, field

from django.conf import settings


class ProviderCallError(Exception):
    """Carrier refused the request. Carries the provider's own error code."""

    def __init__(self, message: str, *, code: str = "", status: int = 0,
                 retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.status = status
        self.retryable = retryable


class ProviderRateLimited(ProviderCallError):
    """Carrier is throttling us. The pacer treats this as a signal to back off."""

    def __init__(self, message: str, *, retry_after: float = 1.0, **kwargs):
        kwargs.setdefault("retryable", True)
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


@dataclass
class CallHandle:
    sid: str
    status: str = "queued"
    raw: dict = field(default_factory=dict)


@dataclass
class OriginateRequest:
    """
    Everything needed to place one call.

    Assembled by the dispatch task so the adapter has no opinion about
    campaigns, contacts or compliance — it just dials.
    """

    to: str
    from_: str
    answer_url: str
    status_callback_url: str
    ring_timeout: int = 30
    amd_enabled: bool = False
    amd_mode: str = "DetectMessageEnd"
    amd_async: bool = True
    amd_timeout: int = 30
    amd_callback_url: str = ""
    record: bool = False
    recording_callback_url: str = ""
    machine_detection_speech_threshold: int = 2400
    caller_name: str = ""
    metadata: dict = field(default_factory=dict)


class ProviderAdapter:
    """Interface every carrier adapter implements."""

    name = "base"

    # --- outbound -------------------------------------------------------
    def place_call(self, request: OriginateRequest) -> CallHandle:
        raise NotImplementedError

    def hangup(self, sid: str) -> None:
        raise NotImplementedError

    def redirect(self, sid: str, *, twiml: str | None = None,
                 url: str | None = None) -> None:
        """Move a live call to new instructions — the AMD voicemail drop."""
        raise NotImplementedError

    def fetch_call(self, sid: str) -> dict:
        raise NotImplementedError

    # --- lookup ---------------------------------------------------------
    def lookup_numbers(self, numbers: list[str]) -> dict[str, dict]:
        """Return {e164: {"line_type": ..., "carrier_name": ..., "invalid": bool}}."""
        return {}

    # --- inbound --------------------------------------------------------
    def verify_signature(self, *, url: str, body: bytes, headers) -> bool:
        raise NotImplementedError

    # --- helpers --------------------------------------------------------
    @staticmethod
    def callback_url(path: str) -> str:
        return f"{settings.PUBLIC_BASE_URL.rstrip('/')}{path}"

    def normalise_status(self, provider_status: str) -> str:
        """Map a provider status string onto CallStatus."""
        from apps.common.enums import CallStatus

        mapping = {
            "queued": CallStatus.QUEUED,
            "initiated": CallStatus.INITIATED,
            "ringing": CallStatus.RINGING,
            "in-progress": CallStatus.IN_PROGRESS,
            "in_progress": CallStatus.IN_PROGRESS,
            "answered": CallStatus.IN_PROGRESS,
            "completed": CallStatus.COMPLETED,
            "busy": CallStatus.BUSY,
            "no-answer": CallStatus.NO_ANSWER,
            "no_answer": CallStatus.NO_ANSWER,
            "failed": CallStatus.FAILED,
            "canceled": CallStatus.CANCELED,
            "cancelled": CallStatus.CANCELED,
        }
        return mapping.get((provider_status or "").lower(), CallStatus.FAILED)

    def normalise_answered_by(self, value: str) -> str:
        from apps.common.enums import AnsweredBy

        mapping = {
            "human": AnsweredBy.HUMAN,
            "machine_start": AnsweredBy.MACHINE_START,
            "machine_end_beep": AnsweredBy.MACHINE_END_BEEP,
            "machine_end_silence": AnsweredBy.MACHINE_END_SIL,
            "machine_end_other": AnsweredBy.MACHINE_END_OTH,
            "fax": AnsweredBy.FAX,
            "unknown": AnsweredBy.UNKNOWN,
        }
        return mapping.get((value or "").lower(), AnsweredBy.UNKNOWN)
