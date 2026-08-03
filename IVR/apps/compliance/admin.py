from django.contrib import admin

from apps.common.admin import TenantModelAdmin
from apps.compliance.models import (
    CallingWindow,
    ComplianceIncident,
    DNCEntry,
    NpaJurisdiction,
    ScrubJob,
)


@admin.register(DNCEntry)
class DNCEntryAdmin(TenantModelAdmin):
    list_display = ("__str__", "organization", "reason", "scope_campaign",
                    "is_global", "expires_at", "created_at")
    list_filter = ("reason", "is_global", "organization")
    search_fields = ("phone_hash",)
    raw_id_fields = ("scope_campaign", "source_call")


@admin.register(CallingWindow)
class CallingWindowAdmin(TenantModelAdmin):
    list_display = ("jurisdiction", "organization", "start_local", "end_local",
                    "holidays_blocked")
    list_filter = ("jurisdiction", "holidays_blocked", "organization")


@admin.register(NpaJurisdiction)
class NpaJurisdictionAdmin(admin.ModelAdmin):
    list_display = ("npa", "state", "timezone")
    search_fields = ("npa", "state")


@admin.register(ScrubJob)
class ScrubJobAdmin(TenantModelAdmin):
    list_display = ("source", "organization", "status", "records_processed",
                    "records_added", "started_at", "finished_at")
    list_filter = ("source", "status", "organization")
    readonly_fields = [f.name for f in ScrubJob._meta.fields]


@admin.register(ComplianceIncident)
class ComplianceIncidentAdmin(TenantModelAdmin):
    list_display = ("kind", "organization", "campaign", "acknowledged_at",
                    "created_at")
    list_filter = ("kind", "organization")
    raw_id_fields = ("campaign", "call", "acknowledged_by")
