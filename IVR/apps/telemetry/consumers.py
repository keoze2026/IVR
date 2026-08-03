"""
Channels consumer (spec 10.3).

One group per campaign. The consumer authenticates, authorises against the
campaign's organisation, then joins `campaign.{id}` and relays whatever the
telemetry tasks push.

The authorisation check is the whole point of this file. A websocket URL is a
URL: `/ws/campaigns/<uuid>/` with someone else's campaign id must be refused,
not merely fail to be interesting. The check happens once at connect (group
membership is then fixed) and again on any subscribe message.
"""

from __future__ import annotations

import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.common.redis_clients import Keys

logger = logging.getLogger("ivr.dialer")

#: Close codes the frontend distinguishes.
CLOSE_UNAUTHENTICATED = 4001
CLOSE_FORBIDDEN = 4003
CLOSE_NOT_FOUND = 4004


class CampaignConsumer(AsyncJsonWebsocketConsumer):
    groups: list[str] = []

    async def connect(self):
        self.campaign_id = self.scope["url_route"]["kwargs"]["campaign_id"]
        user = self.scope.get("user")
        organization = self.scope.get("organization")

        if user is None or not getattr(user, "is_authenticated", False):
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return

        allowed = await self._can_view(organization, self.campaign_id)
        if allowed is None:
            await self.close(code=CLOSE_NOT_FOUND)
            return
        if not allowed:
            logger.warning(
                "websocket cross-tenant attempt",
                extra={"campaign": self.campaign_id, "user": str(user)},
            )
            await self.close(code=CLOSE_FORBIDDEN)
            return

        self.group_name = Keys.channel_group(self.campaign_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Send the current state immediately rather than making the client wait
        # up to five seconds for the next flush.
        await self.send_json(
            {
                "type": "kpi.snapshot",
                "payload": await self._snapshot(self.campaign_id),
            }
        )

    async def disconnect(self, code):
        group = getattr(self, "group_name", None)
        if group:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        action = content.get("action")
        if action == "ping":
            await self.send_json({"type": "pong"})
        elif action == "refresh":
            await self.send_json(
                {"type": "kpi.snapshot",
                 "payload": await self._snapshot(self.campaign_id)}
            )
        else:
            await self.send_json(
                {"type": "error",
                 "payload": {"code": "unknown_action", "action": action}}
            )

    # --- group handler --------------------------------------------------
    async def campaign_message(self, event):
        """Relay a message pushed by telemetry.tasks._push."""
        await self.send_json(
            {
                "type": event.get("message_type", "message"),
                "payload": event.get("payload", {}),
                "ts": event.get("ts"),
            }
        )

    # --- helpers --------------------------------------------------------
    @database_sync_to_async
    def _can_view(self, organization, campaign_id) -> bool | None:
        from apps.campaigns.models import Campaign

        row = (
            Campaign.objects.unscoped()
            .filter(pk=campaign_id)
            .values_list("organization_id", flat=True)
            .first()
        )
        if row is None:
            return None
        return organization is not None and str(row) == str(organization.pk)

    @database_sync_to_async
    def _snapshot(self, campaign_id) -> dict:
        from apps.telemetry.counters import build_frame

        return build_frame(campaign_id)
