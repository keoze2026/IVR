from django.contrib import admin

from apps.campaigns.models import CallerID, Campaign, CampaignContact, CampaignStats
from apps.common.admin import TenantModelAdmin


@admin.register(Campaign)
class CampaignAdmin(TenantModelAdmin):
    list_display = ("name", "organization", "status", "cps_limit",
                    "max_concurrent_channels", "started_at", "completed_at")
    list_filter = ("status", "organization", "amd_enabled", "record_calls")
    search_fields = ("name",)
    raw_id_fields = ("flow_version", "caller_id", "created_by")
    readonly_fields = ("started_at", "completed_at", "queue_built_at")


@admin.register(CallerID)
class CallerIDAdmin(TenantModelAdmin):
    list_display = ("phone_e164", "friendly_name", "organization", "provider",
                    "attestation", "reputation_score", "is_active")
    list_filter = ("provider", "attestation", "is_active", "organization")
    search_fields = ("phone_e164", "friendly_name")


@admin.register(CampaignContact)
class CampaignContactAdmin(TenantModelAdmin):
    list_display = ("campaign", "contact", "state", "attempts",
                    "next_attempt_at", "final_disposition")
    list_filter = ("state", "final_disposition")
    raw_id_fields = ("campaign", "contact")
    # The queue can hold millions of rows; the default count query would time
    # out the changelist.
    show_full_result_count = False


@admin.register(CampaignStats)
class CampaignStatsAdmin(TenantModelAdmin):
    list_display = ("campaign", "dialed", "answered", "human", "machine",
                    "transferred", "opted_out", "last_flushed_at")
    raw_id_fields = ("campaign",)
    readonly_fields = [f.name for f in CampaignStats._meta.fields]
