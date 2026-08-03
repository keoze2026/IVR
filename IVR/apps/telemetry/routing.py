from django.urls import re_path

from apps.telemetry.consumers import CampaignConsumer

UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

websocket_urlpatterns = [
    re_path(rf"^ws/campaigns/(?P<campaign_id>{UUID})/$", CampaignConsumer.as_asgi()),
]
