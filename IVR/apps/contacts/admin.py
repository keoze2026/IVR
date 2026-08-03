from django.contrib import admin

from apps.common.admin import TenantModelAdmin
from apps.contacts.models import ConsentRecord, Contact, ContactList


@admin.register(ContactList)
class ContactListAdmin(TenantModelAdmin):
    list_display = ("name", "organization", "total_rows", "valid_rows",
                    "suppressed_rows", "ingest_status", "created_at")
    list_filter = ("ingest_status", "organization")
    search_fields = ("name", "source_filename")


@admin.register(Contact)
class ContactAdmin(TenantModelAdmin):
    list_display = ("__str__", "contact_list", "line_type", "timezone",
                    "is_suppressed", "suppression_reason", "total_attempts")
    list_filter = ("is_suppressed", "suppression_reason", "line_type")
    # Deliberately not searchable by full phone number: admin search on
    # phone_e164 would make the whole contact database greppable from a browser
    # by anyone with staff access. Look up by hash or via the list.
    search_fields = ("phone_hash", "last_name")
    raw_id_fields = ("contact_list",)
    show_full_result_count = False


@admin.register(ConsentRecord)
class ConsentRecordAdmin(TenantModelAdmin):
    list_display = ("__str__", "organization", "consent_type", "scope",
                    "source", "captured_at", "revoked_at")
    list_filter = ("consent_type", "scope", "source", "organization")
    search_fields = ("phone_hash", "evidence_ref")
    readonly_fields = ("phone_hash", "captured_at", "captured_ip",
                       "captured_user_agent", "disclosure_text")

    def has_change_permission(self, request, obj=None):
        # Consent records are evidence; editing one after the fact destroys
        # its value as evidence.
        return False
