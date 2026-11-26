"""
Websocket authentication.

Browsers cannot set headers on a WebSocket handshake, so the API key, or a
signed-in person's token, arrives as a query parameter (`?token=`), or the
session cookie is used. A token in a URL is
visible in proxy logs, which is why keys used this way should be short-lived
and scoped — see the API-key model's `expires_at`.

The middleware resolves both `user` and `organization` into the connection
scope; the consumer authorises against `organization` and never re-derives it.
"""

from __future__ import annotations

from urllib.parse import parse_qs

from channels.auth import AuthMiddlewareStack
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser


def resolve_user_token(raw_token: str):
    """A person's sign-in token, checked exactly as the HTTP API checks it."""
    from types import SimpleNamespace

    from rest_framework.exceptions import AuthenticationFailed

    from apps.accounts.authentication import UserTokenAuthentication

    request = SimpleNamespace(META={"HTTP_AUTHORIZATION": f"Bearer {raw_token}"})
    try:
        user, _ = UserTokenAuthentication().authenticate(request)
    except AuthenticationFailed:
        return None, None
    organization = user.organization
    if organization is None or not organization.is_active:
        return None, None
    return user, organization


@database_sync_to_async
def _resolve_token(raw_token: str):
    from apps.accounts.authentication import USER_TOKEN_PREFIX, APIKeyUser
    from apps.accounts.models import APIKey

    if raw_token.startswith(USER_TOKEN_PREFIX):
        return resolve_user_token(raw_token)

    key = (
        APIKey.objects.select_related("organization")
        .filter(key_hash=APIKey.hash_key(raw_token))
        .first()
    )
    if key is None or not key.is_active or not key.organization.is_active:
        return None, None
    return APIKeyUser(key), key.organization


@database_sync_to_async
def _organization_for(user):
    return getattr(user, "organization", None)


class TokenAuthMiddleware:
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        scope = dict(scope)
        query = parse_qs((scope.get("query_string") or b"").decode())
        token = (query.get("token") or [""])[0]

        if token:
            user, organization = await _resolve_token(token)
            scope["user"] = user or AnonymousUser()
            scope["organization"] = organization
        else:
            user = scope.get("user")
            scope["organization"] = (
                await _organization_for(user)
                if user is not None and getattr(user, "is_authenticated", False)
                else None
            )

        return await self.inner(scope, receive, send)


def TokenAuthMiddlewareStack(inner):  # noqa: N802 - Channels naming convention
    """Session auth first, then the token layer on top."""
    return TokenAuthMiddleware(AuthMiddlewareStack(inner))
