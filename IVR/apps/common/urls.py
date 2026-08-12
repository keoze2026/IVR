"""
API v1 router aggregation (spec 11).

One router for the whole versioned surface keeps the URL namespace flat and
predictable for the frontend:

    /api/v1/campaigns/
    /api/v1/contact-lists/
    /api/v1/contacts/
    /api/v1/flows/
    /api/v1/caller-ids/
    /api/v1/calls/
    /api/v1/dnc/
    /api/v1/consent/
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import APIKeyViewSet, MeView
from apps.campaigns.views import CallerIDViewSet, CampaignViewSet
from apps.compliance.views import (
    CallingWindowViewSet,
    ConsentRecordViewSet,
    DNCEntryViewSet,
)
from apps.contacts.views import ContactListViewSet, ContactViewSet
from apps.ivr.views import IVRFlowVersionViewSet, IVRFlowViewSet
from apps.telephony.views import CallLogViewSet

router = DefaultRouter()
router.register("campaigns", CampaignViewSet, basename="campaign")
router.register("caller-ids", CallerIDViewSet, basename="caller-id")
router.register("contact-lists", ContactListViewSet, basename="contact-list")
router.register("contacts", ContactViewSet, basename="contact")
router.register("flows", IVRFlowViewSet, basename="flow")
router.register("flow-versions", IVRFlowVersionViewSet, basename="flow-version")
router.register("calls", CallLogViewSet, basename="call")
router.register("dnc", DNCEntryViewSet, basename="dnc")
router.register("consent", ConsentRecordViewSet, basename="consent")
router.register("calling-windows", CallingWindowViewSet, basename="calling-window")
router.register("api-keys", APIKeyViewSet, basename="api-key")

urlpatterns = [
    # Not a viewset: there is no collection here, only the caller. Registered
    # before the router so "me" cannot be shadowed by a future detail route.
    path("me/", MeView.as_view(), name="me"),
    path("", include(router.urls)),
]
