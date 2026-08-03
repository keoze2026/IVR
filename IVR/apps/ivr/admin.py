from django.contrib import admin

from apps.common.admin import TenantModelAdmin
from apps.ivr.models import AudioAsset, IVRFlow, IVRFlowVersion, TransferEndpoint


@admin.register(IVRFlow)
class IVRFlowAdmin(TenantModelAdmin):
    list_display = ("name", "organization", "is_archived", "created_at")
    list_filter = ("is_archived", "organization")
    search_fields = ("name",)


@admin.register(IVRFlowVersion)
class IVRFlowVersionAdmin(TenantModelAdmin):
    list_display = ("flow", "version", "is_published", "published_at",
                    "prompts_rendered_at")
    list_filter = ("is_published", "organization")
    raw_id_fields = ("flow", "published_by")
    readonly_fields = ("checksum", "validation_report", "rendered_prompts")

    def has_change_permission(self, request, obj=None):
        # Published versions are immutable — campaigns pin them precisely so
        # that a call's behaviour is reconstructable after the fact.
        return obj is None or not obj.is_published


@admin.register(AudioAsset)
class AudioAssetAdmin(TenantModelAdmin):
    list_display = ("name", "organization", "source", "voice_id",
                    "duration_ms", "created_at")
    list_filter = ("source", "organization")
    search_fields = ("name", "source_text")


@admin.register(TransferEndpoint)
class TransferEndpointAdmin(TenantModelAdmin):
    list_display = ("name", "organization", "kind", "destination",
                    "max_concurrent", "is_active")
    list_filter = ("kind", "is_active", "organization")
    search_fields = ("name", "destination")
