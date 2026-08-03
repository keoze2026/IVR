"""
Tenancy, identity and authorisation.

An Organization is the tenancy boundary *and* the compliance boundary: consent,
DNC, caller IDs and calling windows all belong to one. Two brands operated by
the same legal entity should be two organisations if a consumer revoking
consent for one should not silently revoke it for the other.
"""

import hashlib
import secrets
import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models

from apps.common.models import TimestampedModel


class Organization(TimestampedModel):
    name = models.CharField(max_length=160)
    slug = models.SlugField(max_length=64, unique=True)

    # --- Legal identity, needed for carrier vetting and for the CNAM record --
    legal_entity_name = models.CharField(max_length=255, blank=True)
    tax_id = models.CharField(max_length=64, blank=True)
    support_phone = models.CharField(max_length=16, blank=True)
    support_email = models.EmailField(blank=True)
    website = models.URLField(blank=True)

    # --- Platform-level guardrails -----------------------------------------
    # Ceilings the tenant cannot exceed regardless of per-campaign settings.
    # These are the operator's protection against a customer torching the
    # shared carrier account's reputation.
    max_cps = models.FloatField(default=10.0)
    max_concurrent_channels = models.PositiveIntegerField(default=100)
    max_contacts = models.PositiveIntegerField(default=1_000_000)

    # --- Compliance posture -------------------------------------------------
    # Countries this tenant is permitted to dial. Empty = the default region
    # only. Checked at ingest and again in the pre-dial gate.
    permitted_countries = models.JSONField(default=list, blank=True)
    require_consent_for_marketing = models.BooleanField(default=True)
    # Federal DNC Subscription Account Number, when the tenant holds one.
    dnc_san = models.CharField(max_length=32, blank=True)
    litigator_scrub_enabled = models.BooleanField(default=True)
    recording_retention_days = models.PositiveIntegerField(default=365)

    is_active = models.BooleanField(default=True)
    # Set by an operator to stop every campaign in the tenant immediately.
    is_suspended = models.BooleanField(default=False)
    suspension_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        indexes = [models.Index(fields=["slug"])]

    def __str__(self):
        return self.name


class Role(models.TextChoices):
    OWNER = "owner", "Owner"
    ADMIN = "admin", "Administrator"
    OPERATOR = "operator", "Campaign operator"
    ANALYST = "analyst", "Analyst (read only)"
    COMPLIANCE = "compliance", "Compliance officer"


#: Capability matrix. Kept as data rather than scattered `if role ==` checks so
#: the permission classes and the API docs read from one source.
ROLE_CAPABILITIES = {
    Role.OWNER: {
        "campaign.view", "campaign.edit", "campaign.control",
        "contacts.view", "contacts.edit", "contacts.export",
        "flow.view", "flow.edit", "flow.publish",
        "compliance.view", "compliance.edit",
        "org.manage", "recordings.listen",
    },
    Role.ADMIN: {
        "campaign.view", "campaign.edit", "campaign.control",
        "contacts.view", "contacts.edit", "contacts.export",
        "flow.view", "flow.edit", "flow.publish",
        "compliance.view", "compliance.edit", "recordings.listen",
    },
    Role.OPERATOR: {
        "campaign.view", "campaign.edit", "campaign.control",
        "contacts.view", "contacts.edit",
        "flow.view", "compliance.view",
    },
    Role.ANALYST: {"campaign.view", "contacts.view", "flow.view", "compliance.view"},
    # Compliance can always add a suppression and can always stop a campaign,
    # but cannot start one or edit its targeting.
    Role.COMPLIANCE: {
        "campaign.view", "campaign.control",
        "contacts.view", "contacts.export",
        "flow.view", "compliance.view", "compliance.edit",
        "recordings.listen",
    },
}


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="users",
        null=True, blank=True,
    )
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.OPERATOR)
    phone = models.CharField(max_length=16, blank=True)
    mfa_enabled = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["organization", "role"])]

    def has_capability(self, capability: str) -> bool:
        if self.is_superuser:
            return True
        return capability in ROLE_CAPABILITIES.get(self.role, set())


class APIKey(TimestampedModel):
    """
    Machine credential for server-to-server use.

    Only the SHA-256 of the key is stored. The plaintext is shown once at
    creation and is unrecoverable afterwards; a leaked key is revoked and
    reissued, never "looked up".
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="api_keys"
    )
    name = models.CharField(max_length=120)
    prefix = models.CharField(max_length=12, unique=True)
    key_hash = models.CharField(max_length=64, unique=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.OPERATOR)
    created_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )
    last_used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    # Optional source-IP restriction, CIDR strings.
    allowed_cidrs = models.JSONField(default=list, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["key_hash"]),
            models.Index(fields=["organization", "-created_at"]),
        ]

    @classmethod
    def generate(cls, organization, name: str, role: str = Role.OPERATOR, **kwargs):
        raw = f"ivrk_{secrets.token_urlsafe(32)}"
        instance = cls.objects.create(
            organization=organization,
            name=name,
            role=role,
            prefix=raw[:12],
            key_hash=cls.hash_key(raw),
            **kwargs,
        )
        return instance, raw

    @staticmethod
    def hash_key(raw: str) -> str:
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @property
    def is_active(self) -> bool:
        from django.utils import timezone

        if self.revoked_at:
            return False
        return not (self.expires_at and self.expires_at <= timezone.now())


class AuditLogEntry(TimestampedModel):
    """
    Append-only record of every state-changing operator action.

    Spec 1.1 requires a call to be reconstructable end to end; that includes
    who started the campaign that placed it and who published the flow it ran.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="audit_log"
    )
    actor = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    api_key = models.ForeignKey(
        APIKey, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    action = models.CharField(max_length=64)
    target_type = models.CharField(max_length=64, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["organization", "-created_at"]),
            models.Index(fields=["organization", "action", "-created_at"]),
            models.Index(fields=["target_type", "target_id"]),
        ]
