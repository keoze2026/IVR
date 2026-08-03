"""IVR flows (spec 4.5) plus the transfer-destination allowlist."""

from django.db import models

from apps.common.models import TenantModel


class IVRFlow(TenantModel):
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    is_archived = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "name"], name="uniq_flow_name_per_org"
            ),
        ]
        indexes = [models.Index(fields=["organization", "-created_at"])]

    def __str__(self):
        return self.name

    @property
    def latest_version(self):
        return self.versions.order_by("-version").first()

    @property
    def latest_published(self):
        return self.versions.filter(is_published=True).order_by("-version").first()


class IVRFlowVersion(TenantModel):
    """Immutable once published. Campaigns pin a version so that editing a flow
    never changes the behaviour of calls already in flight."""

    flow = models.ForeignKey(IVRFlow, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    definition = models.JSONField()  # the DSL document, see spec 6.1
    entry_node = models.CharField(max_length=64)
    checksum = models.CharField(max_length=64)
    is_published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )
    # Map of {node_id: {locale: s3_key}} for pre-rendered TTS
    rendered_prompts = models.JSONField(default=dict, blank=True)
    prompts_rendered_at = models.DateTimeField(null=True, blank=True)
    # Result of the last publish-time validation, kept for the audit trail.
    validation_report = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["flow", "version"], name="uniq_flow_version"),
        ]
        indexes = [models.Index(fields=["flow", "-version"])]

    def __str__(self):
        return f"{self.flow.name} v{self.version}"

    @property
    def nodes(self) -> dict:
        return (self.definition or {}).get("nodes", {})

    @property
    def is_editable(self) -> bool:
        """Published versions are frozen. Edits create a new version."""
        return not self.is_published

    def node(self, node_id: str) -> dict | None:
        return self.nodes.get(node_id)


class AudioAsset(TenantModel):
    name = models.CharField(max_length=160)
    storage_key = models.CharField(max_length=512)
    mime_type = models.CharField(max_length=48)  # audio/mpeg | audio/wav
    duration_ms = models.PositiveIntegerField(default=0)
    sample_rate = models.PositiveIntegerField(default=8000)
    source = models.CharField(max_length=24, default="upload")  # upload|polly|elevenlabs
    source_text = models.TextField(blank=True)
    voice_id = models.CharField(max_length=64, blank=True)
    # SHA-256 of (text, voice, engine); lets the renderer skip work that has
    # already been done for an identical prompt in another flow.
    render_key = models.CharField(max_length=64, blank=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=["organization", "-created_at"]),
            models.Index(fields=["organization", "render_key"]),
        ]

    def __str__(self):
        return self.name


class TransferEndpoint(TenantModel):
    """
    Allowlisted live-transfer destination.

    Transfer targets are references to rows in this table, never free-text
    dial strings in the flow document. That is what keeps the DSL from being a
    toll-fraud primitive: an operator who can edit a flow cannot make it dial
    an arbitrary premium-rate number, only one an administrator has registered.
    """

    class Kind(models.TextChoices):
        PSTN = "pstn", "PSTN number"
        SIP = "sip", "SIP URI"

    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=8, choices=Kind.choices, default=Kind.PSTN)
    # E.164 for PSTN, sip:user@host for SIP.
    destination = models.CharField(max_length=255)
    caller_id_override = models.CharField(max_length=16, blank=True)
    timeout_seconds = models.PositiveSmallIntegerField(default=30)
    # Optional cap on simultaneous transfers, so a broadcast cannot bury a
    # five-seat agent queue under four hundred bridged calls.
    max_concurrent = models.PositiveIntegerField(default=0)  # 0 = unlimited
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "name"], name="uniq_transfer_endpoint_name"
            ),
        ]
        indexes = [models.Index(fields=["organization", "is_active"])]

    def __str__(self):
        return f"{self.name} ({self.kind})"
