from django.contrib import admin

from apps.common.admin import TenantModelAdmin
from apps.telephony.models import CallLog, DTMFResponse


@admin.register(CallLog)
class CallLogAdmin(TenantModelAdmin):
    list_display = ("provider_call_sid", "campaign", "status", "answered_by",
                    "disposition", "duration_seconds", "cost", "created_at")
    list_filter = ("status", "answered_by", "disposition", "provider")
    search_fields = ("provider_call_sid",)
    raw_id_fields = ("campaign", "contact", "flow_version", "consent_record")
    readonly_fields = [f.name for f in CallLog._meta.fields]
    show_full_result_count = False

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        # Call records are the evidence trail. They are written by the event
        # pipeline and by nothing else.
        return False


@admin.register(DTMFResponse)
class DTMFResponseAdmin(TenantModelAdmin):
    list_display = ("call", "node_id", "digits", "attempt", "is_valid",
                    "created_at")
    list_filter = ("is_valid", "node_id")
    raw_id_fields = ("call",)
    show_full_result_count = False
