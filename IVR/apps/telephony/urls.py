"""
Carrier webhook routes.

The provider is part of the path so that a dual-carrier deployment can route,
verify and rate-limit each carrier independently at the edge, and so that a
callback can never be verified against the wrong provider's key.
"""

from django.http import HttpResponseNotFound
from django.urls import path, re_path

from apps.telephony.media import PromptMediaView
from apps.telephony.webhooks import (
    AMDView,
    IVREntryView,
    IVRGatherView,
    RecordingCallbackView,
    StatusCallbackView,
    WhisperView,
)

PROVIDER = r"(?P<provider>twilio|telnyx)"

urlpatterns = [
    re_path(rf"^{PROVIDER}/ivr/entry/$", IVREntryView.as_view(), name="ivr-entry"),
    re_path(rf"^{PROVIDER}/ivr/gather/$", IVRGatherView.as_view(), name="ivr-gather"),
    re_path(rf"^{PROVIDER}/ivr/whisper/$", WhisperView.as_view(), name="ivr-whisper"),
    re_path(rf"^{PROVIDER}/amd/$", AMDView.as_view(), name="amd-callback"),
    re_path(rf"^{PROVIDER}/status/$", StatusCallbackView.as_view(),
            name="status-callback"),
    re_path(rf"^{PROVIDER}/recording/$", RecordingCallbackView.as_view(),
            name="recording-callback"),
    # Prompt audio served through the app so the carrier can fetch it over a
    # public HTTPS URL instead of an internal presigned MinIO link.
    path("media/prompt/<uuid:asset_id>/", PromptMediaView.as_view(),
         name="prompt-media"),
    # A misconfigured carrier console entry should say what is wrong rather
    # than return a bare 404 that looks like an outage.
    path("", lambda request: HttpResponseNotFound(
        "Specify a provider: /webhooks/twilio/... or /webhooks/telnyx/..."
    ), name="webhook-root"),
]
