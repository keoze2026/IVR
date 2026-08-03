"""Shared enumerations (spec 4.2)."""

from django.db import models


class CampaignStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    SCHEDULED = "scheduled", "Scheduled"
    RUNNING = "running", "Running"
    PAUSED = "paused", "Paused"
    THROTTLED = "throttled", "Throttled by carrier"
    COMPLETED = "completed", "Completed"
    STOPPED = "stopped", "Stopped"
    FAILED = "failed", "Failed"


#: Statuses in which the pacer is allowed to place calls.
DIALABLE_CAMPAIGN_STATES = {CampaignStatus.RUNNING, CampaignStatus.THROTTLED}

#: Terminal statuses — no further transition is possible.
TERMINAL_CAMPAIGN_STATES = {
    CampaignStatus.COMPLETED,
    CampaignStatus.STOPPED,
    CampaignStatus.FAILED,
}


class CallStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    INITIATED = "initiated", "Initiated"
    RINGING = "ringing", "Ringing"
    IN_PROGRESS = "in_progress", "In progress"
    COMPLETED = "completed", "Completed"
    BUSY = "busy", "Busy"
    NO_ANSWER = "no_answer", "No answer"
    FAILED = "failed", "Failed"
    CANCELED = "canceled", "Canceled"


#: A call in one of these states still occupies a channel.
LIVE_CALL_STATES = {
    CallStatus.QUEUED,
    CallStatus.INITIATED,
    CallStatus.RINGING,
    CallStatus.IN_PROGRESS,
}

TERMINAL_CALL_STATES = {
    CallStatus.COMPLETED,
    CallStatus.BUSY,
    CallStatus.NO_ANSWER,
    CallStatus.FAILED,
    CallStatus.CANCELED,
}

#: Monotonic ordering used to reject out-of-order carrier callbacks (spec 8.5).
#: A callback that would move a call backwards through this ranking is recorded
#: as a raw event but does not mutate CallLog.status.
CALL_STATUS_RANK = {
    CallStatus.QUEUED: 0,
    CallStatus.INITIATED: 1,
    CallStatus.RINGING: 2,
    CallStatus.IN_PROGRESS: 3,
    CallStatus.BUSY: 4,
    CallStatus.NO_ANSWER: 4,
    CallStatus.FAILED: 4,
    CallStatus.CANCELED: 4,
    CallStatus.COMPLETED: 5,
}


class AnsweredBy(models.TextChoices):
    HUMAN = "human", "Human"
    MACHINE_START = "machine_start", "Machine (greeting start)"
    MACHINE_END_BEEP = "machine_end_beep", "Machine (beep detected)"
    MACHINE_END_SIL = "machine_end_silence", "Machine (silence)"
    MACHINE_END_OTH = "machine_end_other", "Machine (other)"
    FAX = "fax", "Fax"
    UNKNOWN = "unknown", "Unknown"


MACHINE_ANSWERS = {
    AnsweredBy.MACHINE_START,
    AnsweredBy.MACHINE_END_BEEP,
    AnsweredBy.MACHINE_END_SIL,
    AnsweredBy.MACHINE_END_OTH,
}


class Disposition(models.TextChoices):
    """Business outcome, distinct from the carrier's technical status."""

    CONFIRMED = "confirmed", "Confirmed (DTMF)"
    TRANSFERRED = "transferred", "Transferred to agent"
    OPTED_OUT = "opted_out", "Opted out"
    VOICEMAIL = "voicemail", "Voicemail left"
    ABANDONED = "abandoned", "Abandoned by caller"
    NO_INPUT = "no_input", "No DTMF input"
    UNREACHABLE = "unreachable", "Unreachable"
    SUPPRESSED = "suppressed", "Suppressed before dial"


class SuppressionReason(models.TextChoices):
    INTERNAL_DNC = "internal_dnc", "Internal DNC"
    IVR_OPT_OUT = "ivr_opt_out", "Opted out via IVR"
    FEDERAL_DNC = "federal_dnc", "Federal DNC registry"
    STATE_DNC = "state_dnc", "State DNC registry"
    LITIGATOR = "litigator", "Known litigator / trap line"
    CARRIER_INVALID = "carrier_invalid", "Invalid or unassigned number"
    WIRELESS_BLOCK = "wireless_block", "Wireless, no consent on file"
    COMPLAINT = "complaint", "Complaint received"
    ERASURE_REQUEST = "erasure_request", "GDPR/CCPA erasure request"
    NO_CONSENT = "no_consent", "No consent record on file"
    OUT_OF_WINDOW = "out_of_window", "Outside permitted calling window"
    ATTEMPT_CAP = "attempt_cap", "Daily attempt cap reached"


class QueueState(models.TextChoices):
    """CampaignContact lifecycle (spec 4.6)."""

    PENDING = "pending", "Pending"
    DIALING = "dialing", "Dialing"
    DONE = "done", "Done"
    FAILED = "failed", "Failed"
    SUPPRESSED = "suppressed", "Suppressed"
    EXHAUSTED = "exhausted", "Attempts exhausted"


class ConsentType(models.TextChoices):
    EXPRESS_WRITTEN = "express_written", "Prior express written consent"
    EXPRESS_ORAL = "express_oral", "Prior express consent (oral)"
    EBR = "ebr", "Established business relationship"
    TRANSACTIONAL = "transactional", "Transactional / informational"


class ConsentScope(models.TextChoices):
    MARKETING = "marketing", "Marketing"
    INFORMATIONAL = "informational", "Informational"
