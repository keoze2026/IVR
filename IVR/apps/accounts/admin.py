from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from apps.accounts.models import APIKey, AuditLogEntry, Organization, User


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "max_cps", "max_concurrent_channels",
                    "is_active", "is_suspended", "created_at")
    list_filter = ("is_active", "is_suspended", "require_consent_for_marketing")
    search_fields = ("name", "slug", "legal_entity_name")


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ("username", "email", "organization", "role", "is_active")
    list_filter = ("role", "is_active", "organization")
    fieldsets = DjangoUserAdmin.fieldsets + (
        ("Tenancy", {"fields": ("organization", "role", "phone", "mfa_enabled")}),
    )


@admin.register(APIKey)
class APIKeyAdmin(admin.ModelAdmin):
    list_display = ("name", "prefix", "organization", "role",
                    "last_used_at", "expires_at", "revoked_at")
    list_filter = ("role", "organization")
    readonly_fields = ("prefix", "key_hash", "last_used_at")


@admin.register(AuditLogEntry)
class AuditLogEntryAdmin(admin.ModelAdmin):
    list_display = ("created_at", "organization", "actor", "action",
                    "target_type", "target_id")
    list_filter = ("action", "organization")
    search_fields = ("target_id", "action")
    readonly_fields = [f.name for f in AuditLogEntry._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
