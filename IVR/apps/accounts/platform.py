"""
The platform administration API.

What Django admin gave us and this replaces: create, read, update and delete on
every model, for an operator who is above tenancy. What it did badly, and why
replacing it is worth the code: it is a developer's tool wearing an
administrator's clothes. It shows database column names, its delete confirmation
lists opaque cascades, and it cannot be handed to somebody without explaining
what a foreign key is.

The approach here is the one Django admin itself takes — describe the models
once and generate the surface from that description, rather than hand-writing
23 viewsets that drift apart. `REGISTRY` is that description. The API exposes
it at /platform/schema/ so the client can render tables and forms for a model
it has never heard of, which means adding a model to the admin is a one-line
change here and nothing at all in the frontend.

Two rules hold everywhere in this module:

  * superuser only. Not a capability, not a role — `is_superuser`. These
    endpoints cross tenant boundaries by design, so the ordinary permission
    classes would be actively wrong here.

  * every write is audited. An administrator acting across tenants is exactly
    the actor whose changes need a record.
"""

from __future__ import annotations

from django.apps import apps as django_apps
from django.db import models as db_models
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from apps.accounts.models import AuditLogEntry

# ---------------------------------------------------------------------------
# What the administrator can manage
# ---------------------------------------------------------------------------

#: label -> (app.Model, human name, columns worth showing in a list, search fields)
#:
#: Ordered as an administrator thinks about the system rather than
#: alphabetically: who exists, then what they are calling with, then what was
#: said, then the compliance record, then the raw call data.
REGISTRY: dict[str, dict] = {
    "organizations": {
        "model": "accounts.Organization",
        "label": "Organisations",
        "group": "Tenancy",
        "columns": ["name", "slug", "is_active", "is_suspended", "max_cps",
                    "max_concurrent_channels", "created_at"],
        "search": ["name", "slug", "legal_entity_name"],
    },
    "users": {
        "model": "accounts.User",
        "label": "People",
        "group": "Tenancy",
        "columns": ["username", "email", "organization", "role", "is_active",
                    "is_superuser", "last_seen_at"],
        "search": ["username", "email", "first_name", "last_name"],
    },
    "api-keys": {
        "model": "accounts.APIKey",
        "label": "Machine keys",
        "group": "Tenancy",
        "columns": ["name", "prefix", "organization", "role", "last_used_at",
                    "revoked_at"],
        "search": ["name", "prefix"],
    },
    "audio-pools": {
        "model": "ivr.AudioPool",
        "label": "Audio pools",
        "group": "Calling",
        "columns": ["name", "organization", "rotation", "created_at"],
        "search": ["name"],
    },
    "cli-pools": {
        "model": "campaigns.CLIPool",
        "label": "CLI pools",
        "group": "Calling",
        "columns": ["name", "organization", "rotation", "created_at"],
        "search": ["name"],
    },
    "wallets": {
        "model": "campaigns.Wallet",
        "label": "Wallets",
        "group": "Billing",
        "columns": ["organization", "balance", "currency", "low_balance_threshold"],
        "search": [],
    },
    "tariffs": {
        "model": "campaigns.Tariff",
        "label": "Tariffs",
        "group": "Billing",
        "columns": ["name", "prefix", "per_minute", "currency",
                    "organization", "is_active"],
        "search": ["name", "prefix"],
    },
    "caller-ids": {
        "model": "campaigns.CallerID",
        "label": "Caller IDs",
        "group": "Calling",
        "columns": ["phone_e164", "friendly_name", "organization", "provider",
                    "attestation", "is_active"],
        "search": ["phone_e164", "friendly_name"],
    },
    "campaigns": {
        "model": "campaigns.Campaign",
        "label": "Campaigns",
        "group": "Calling",
        "columns": ["name", "organization", "status", "cps_limit",
                    "max_concurrent_channels", "started_at"],
        "search": ["name"],
    },
    "campaign-contacts": {
        "model": "campaigns.CampaignContact",
        "label": "Campaign queue",
        "group": "Calling",
        "columns": ["campaign", "contact", "state", "attempts",
                    "last_attempt_at", "final_disposition"],
        "search": [],
    },
    "contact-lists": {
        "model": "contacts.ContactList",
        "label": "Contact lists",
        "group": "Contacts",
        "columns": ["name", "organization", "total_rows", "valid_rows",
                    "ingest_status", "created_at"],
        "search": ["name"],
    },
    "contacts": {
        "model": "contacts.Contact",
        "label": "Contacts",
        "group": "Contacts",
        # phone_e164 is deliberately absent: the admin list is the one screen
        # somebody leaves open on a shared monitor. It is on the detail form,
        # where looking at it is a decision rather than an accident.
        "columns": ["first_name", "last_name", "organization", "contact_list",
                    "is_suppressed", "total_attempts"],
        "search": ["first_name", "last_name", "phone_e164"],
    },
    "consent": {
        "model": "contacts.ConsentRecord",
        "label": "Consent records",
        "group": "Compliance",
        "columns": ["phone_e164", "organization", "scope", "source",
                    "captured_at", "revoked_at"],
        "search": ["phone_e164"],
    },
    "dnc": {
        "model": "compliance.DNCEntry",
        "label": "Do-not-call",
        "group": "Compliance",
        "columns": ["phone_e164", "organization", "reason", "scope_campaign",
                    "created_at"],
        "search": ["phone_e164", "reason"],
    },
    "calling-windows": {
        "model": "compliance.CallingWindow",
        "label": "Calling hours",
        "group": "Compliance",
        "columns": ["jurisdiction", "organization", "start_local", "end_local",
                    "is_active"],
        "search": ["jurisdiction"],
    },
    "npa-jurisdictions": {
        "model": "compliance.NpaJurisdiction",
        "label": "Area codes",
        "group": "Compliance",
        "columns": ["npa", "state", "timezone"],
        "search": ["npa", "state"],
    },
    "scrub-jobs": {
        "model": "compliance.ScrubJob",
        "label": "Scrub jobs",
        "group": "Compliance",
        "columns": ["organization", "source", "status", "records_processed",
                    "records_added", "finished_at"],
        "search": [],
    },
    "incidents": {
        "model": "compliance.ComplianceIncident",
        "label": "Incidents",
        "group": "Compliance",
        "columns": ["organization", "kind", "created_at"],
        "search": [],
    },
    "flows": {
        "model": "ivr.IVRFlow",
        "label": "Call scripts",
        "group": "Scripts",
        "columns": ["name", "organization", "is_archived", "created_at"],
        "search": ["name"],
    },
    "flow-versions": {
        "model": "ivr.IVRFlowVersion",
        "label": "Script versions",
        "group": "Scripts",
        "columns": ["flow", "version", "organization", "is_published",
                    "published_at"],
        "search": [],
    },
    "transfer-endpoints": {
        "model": "ivr.TransferEndpoint",
        "label": "Transfer numbers",
        "group": "Scripts",
        "columns": ["name", "organization", "destination", "is_active"],
        "search": ["name", "destination"],
    },
    "audio": {
        "model": "ivr.AudioAsset",
        "label": "Audio files",
        "group": "Scripts",
        "columns": ["name", "organization", "created_at"],
        "search": ["name"],
    },
    "calls": {
        "model": "telephony.CallLog",
        "label": "Calls",
        "group": "Call data",
        "columns": ["provider_call_sid", "organization", "campaign", "status",
                    "disposition", "duration_seconds", "created_at"],
        "search": ["provider_call_sid"],
    },
    "dtmf": {
        "model": "telephony.DTMFResponse",
        "label": "Keypresses",
        "group": "Call data",
        "columns": ["call", "node_id", "digits", "created_at"],
        "search": ["digits"],
    },
    "audit-log": {
        "model": "accounts.AuditLogEntry",
        "label": "Audit log",
        "group": "Call data",
        "columns": ["action", "organization", "user", "api_key", "created_at"],
        "search": ["action"],
        # An audit trail somebody can edit is not an audit trail.
        "readonly": True,
    },
}


class IsPlatformAdministrator(BasePermission):
    """
    `is_superuser`, and nothing else.

    Not a capability and not a role: everything in this module reads and writes
    across every tenant, so the ordinary org-scoped permission classes would
    grant far more than they appear to.
    """

    message = "This area is restricted to platform administrators."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and getattr(request.user, "is_superuser", False)
        )


def _entry(resource: str) -> dict:
    try:
        return REGISTRY[resource]
    except KeyError:
        raise PermissionDenied(f"Unknown resource '{resource}'.") from None


def _model(resource: str):
    return django_apps.get_model(_entry(resource)["model"])


# ---------------------------------------------------------------------------
# Describing a model to a client that has never heard of it
# ---------------------------------------------------------------------------

#: Django field class -> the input a person should be given for it.
_WIDGETS = {
    db_models.BooleanField: "boolean",
    db_models.DateTimeField: "datetime",
    db_models.DateField: "date",
    db_models.TimeField: "time",
    db_models.IntegerField: "number",
    db_models.PositiveIntegerField: "number",
    db_models.SmallIntegerField: "number",
    db_models.BigIntegerField: "number",
    db_models.FloatField: "number",
    db_models.DecimalField: "number",
    db_models.JSONField: "json",
    db_models.TextField: "textarea",
    db_models.EmailField: "email",
    db_models.UUIDField: "text",
}


def describe_field(field) -> dict | None:
    """One field, as something a form generator can render."""
    if isinstance(field, db_models.AutoField):
        return None

    info = {
        "name": field.name,
        "label": field.verbose_name.replace("_", " ").capitalize()
        if hasattr(field, "verbose_name")
        else field.name,
        "required": (
            not field.blank
            and not field.null
            and field.default is db_models.NOT_PROVIDED
        ),
        "editable": field.editable,
        "help": str(getattr(field, "help_text", "") or ""),
    }

    if isinstance(field, db_models.ForeignKey):
        info["widget"] = "reference"
        info["references"] = _resource_for_model(field.related_model)
        info["reference_label"] = field.related_model._meta.verbose_name
        return info

    if getattr(field, "choices", None):
        info["widget"] = "choice"
        info["choices"] = [{"value": v, "label": str(lbl)} for v, lbl in field.choices]
        return info

    for cls, widget in _WIDGETS.items():
        if isinstance(field, cls):
            info["widget"] = widget
            break
    else:
        info["widget"] = "text"

    if isinstance(field, db_models.CharField) and field.max_length:
        info["max_length"] = field.max_length
    return info


def _resource_for_model(model) -> str | None:
    """The registry key a foreign key points at, so the UI can offer a picker."""
    target = f"{model._meta.app_label}.{model.__name__}"
    for key, entry in REGISTRY.items():
        if entry["model"] == target:
            return key
    return None


def describe(resource: str) -> dict:
    entry = _entry(resource)
    model = _model(resource)
    fields = [describe_field(f) for f in model._meta.fields]
    return {
        "resource": resource,
        "label": entry["label"],
        "group": entry["group"],
        "columns": entry["columns"],
        "search": entry["search"],
        "readonly": entry.get("readonly", False),
        "fields": [f for f in fields if f],
    }


@api_view(["GET"])
@permission_classes([IsPlatformAdministrator])
def platform_schema(request):
    """
    Everything the admin UI needs to render itself.

    The client holds no model knowledge at all: it asks for this once and
    builds every table, form and picker from the answer. Adding a model to the
    admin is therefore a REGISTRY entry and no frontend change.
    """
    return Response({"resources": [describe(key) for key in REGISTRY]})


# ---------------------------------------------------------------------------
# The CRUD surface
# ---------------------------------------------------------------------------


#: Never writable, never returned. The password hash and the key digest are the
#: two values whose exposure would defeat the credential they protect, and an
#: administrator has no legitimate reason to read either.
HIDDEN_FIELDS = {"password", "key_hash"}

#: Serializers are generated once per model and reused. Rebuilding one on every
#: request re-runs DRF's field introspection for no benefit.
_SERIALIZER_CACHE: dict[str, type] = {}


def serializer_for(model, entry: dict):
    """A ModelSerializer built on demand, with the unsafe fields withheld."""
    cache_key = f"{model._meta.label}"
    cached = _SERIALIZER_CACHE.get(cache_key)
    if cached is not None:
        return cached

    hidden = tuple(f.name for f in model._meta.fields if f.name in HIDDEN_FIELDS)

    # Built with type() rather than a nested class statement: a class body does
    # not close over the enclosing function's locals, so `model` is not visible
    # inside a `class Meta:` written here and the definition fails at import
    # with a bare NameError.
    meta_attrs: dict = {"model": model}
    if hidden:
        meta_attrs["exclude"] = hidden
    else:
        meta_attrs["fields"] = "__all__"
    meta = type("Meta", (), meta_attrs)

    generated = type(
        f"{model.__name__}PlatformSerializer",
        (serializers.ModelSerializer,),
        {
            "Meta": meta,
            # A human-readable label for every row, so the client can render a
            # foreign key as a name instead of a UUID without knowing anything
            # about the model.
            "display": serializers.SerializerMethodField(),
            "get_display": lambda self, obj: str(obj),
        },
    )
    _SERIALIZER_CACHE[cache_key] = generated
    return generated


class PlatformViewSet(viewsets.ModelViewSet):
    """
    /api/v1/platform/{resource}/ — CRUD on any registered model.

    Deliberately *not* tenant-scoped. Everything else in this codebase is, and
    that is the point of the permission class above: this is the one surface
    where seeing every organisation's rows is the intended behaviour rather
    than a leak.
    """

    permission_classes = [IsPlatformAdministrator]

    @property
    def resource(self) -> str:
        return self.kwargs["resource"]

    def initial(self, request, *args, **kwargs):
        """
        Refuse writes to a read-only resource before anything else runs.

        Checked here rather than in perform_create so the answer is 403 rather
        than a validation error: "you may not edit the audit log" and "that
        field is required" are different statements, and only the first is
        true.
        """
        super().initial(request, *args, **kwargs)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            self._refuse_if_readonly()

    def get_queryset(self):
        model = _model(self.resource)
        qs = model._default_manager.all()

        # Ordinary managers on tenant models are scoped; the unscoped escape
        # hatch is what makes a cross-tenant admin possible at all.
        if hasattr(model._default_manager, "unscoped"):
            qs = model._default_manager.unscoped()

        entry = _entry(self.resource)
        search = self.request.query_params.get("q", "").strip()
        if search and entry["search"]:
            from django.db.models import Q

            condition = Q()
            for field in entry["search"]:
                condition |= Q(**{f"{field}__icontains": search})
            qs = qs.filter(condition)

        org = self.request.query_params.get("organization")
        if org and any(f.name == "organization" for f in model._meta.fields):
            qs = qs.filter(organization_id=org)

        ordering = "-created_at" if any(
            f.name == "created_at" for f in model._meta.fields
        ) else "-pk"
        return qs.order_by(ordering)

    def get_serializer_class(self):
        return serializer_for(_model(self.resource), _entry(self.resource))

    def _refuse_if_readonly(self):
        if _entry(self.resource).get("readonly"):
            raise PermissionDenied(
                f"{_entry(self.resource)['label']} cannot be modified."
            )

    def perform_create(self, serializer):
        self._refuse_if_readonly()
        instance = serializer.save()
        self._record("create", instance)

    def perform_update(self, serializer):
        self._refuse_if_readonly()
        instance = serializer.save()
        self._record("update", instance)

    def perform_destroy(self, instance):
        self._refuse_if_readonly()
        self._record("delete", instance)
        instance.delete()

    def _record(self, verb: str, instance):
        """
        An administrator acting across tenants is the actor most worth logging.

        The organisation is taken from the row rather than the request, because
        the request has none — that is what being a platform administrator
        means — and an entry that cannot say which tenant it touched is close
        to useless.
        """
        actor = self.request.user
        from apps.accounts.models import Organization as OrgModel

        # An Organization is its own tenant; everything else points at one; a
        # few global tables (area codes) belong to none.
        #
        # Deleting an organisation is the exception: the row is left detached,
        # because audit_log cascades and an entry pointing at the organisation
        # would be destroyed by the very deletion it exists to record. The
        # name and id survive in `metadata` instead.
        if isinstance(instance, OrgModel):
            organization = None if verb == "delete" else instance
        else:
            organization = getattr(instance, "organization", None)

        AuditLogEntry.objects.create(
            organization=organization,
            # `actor` is a real User row here. A platform administrator always
            # is one — API keys cannot reach this module at all — so unlike the
            # tenant audit path there is no APIKeyUser to guard against.
            actor=actor if getattr(actor, "pk", None) else None,
            action=f"platform.{self.resource}.{verb}",
            target_type=instance.__class__.__name__,
            target_id=str(instance.pk),
            metadata={"display": str(instance), "by": str(actor)},
        )

    def destroy(self, request, *args, **kwargs):
        """
        Report what a delete actually took with it.

        Django admin's confirmation page exists because deletes cascade, and an
        administrator who cannot see that a campaign takes its call history
        with it will find out afterwards. The count is returned so the UI can
        say so before and confirm after.
        """
        instance = self.get_object()
        self._refuse_if_readonly()

        from django.db.models.deletion import Collector

        collector = Collector(using=instance._state.db)
        collector.collect([instance])
        cascade = {
            model._meta.verbose_name_plural.title(): len(objs)
            for model, objs in collector.data.items()
            if objs
        }

        self._record("delete", instance)
        instance.delete()
        return Response({"deleted": cascade}, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsPlatformAdministrator])
def platform_overview(request):
    """Row counts per resource — the landing screen."""
    counts = {}
    for key in REGISTRY:
        model = _model(key)
        manager = model._default_manager
        qs = manager.unscoped() if hasattr(manager, "unscoped") else manager.all()
        counts[key] = qs.count()
    return Response({"counts": counts})
