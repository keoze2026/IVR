"""
Telnyx TeXML adapter.

TeXML is deliberately Twilio-shaped, so this adapter mirrors the Twilio one
almost parameter for parameter. Implemented over the REST API directly rather
than the Telnyx SDK: the TeXML surface is a handful of endpoints, and one fewer
vendor SDK in the dispatch path is one fewer thing to pin, patch and debug at
3 a.m.
"""

from __future__ import annotations

import base64
import logging
import time

import requests
from django.conf import settings

from apps.dialer.providers.base import (
    CallHandle,
    OriginateRequest,
    ProviderAdapter,
    ProviderCallError,
    ProviderRateLimited,
)

logger = logging.getLogger("ivr.dialer")

API_ROOT = "https://api.telnyx.com/v2"
TIMEOUT = (3.05, 10)


class TelnyxAdapter(ProviderAdapter):
    name = "telnyx"

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {settings.TELNYX_API_KEY}"}

    @property
    def _texml_base(self) -> str:
        return f"{API_ROOT}/texml/Accounts/{settings.TELNYX_CONNECTION_ID}"

    # --- outbound -------------------------------------------------------
    def place_call(self, request: OriginateRequest) -> CallHandle:
        data = {
            "To": request.to,
            "From": request.from_,
            "Url": request.answer_url,
            "StatusCallback": request.status_callback_url,
            "StatusCallbackMethod": "POST",
            "StatusCallbackEvent": "initiated ringing answered completed",
            "Timeout": request.ring_timeout,
        }
        if request.amd_enabled:
            data["MachineDetection"] = (
                "DetectMessageEnd" if request.amd_mode == "DetectMessageEnd"
                else "Enable"
            )
            data["MachineDetectionTimeout"] = request.amd_timeout
            if request.amd_async and request.amd_callback_url:
                data["AsyncAmd"] = "true"
                data["AsyncAmdStatusCallback"] = request.amd_callback_url
                data["AsyncAmdStatusCallbackMethod"] = "POST"
        if request.record:
            data["Record"] = "true"
            if request.recording_callback_url:
                data["RecordingStatusCallback"] = request.recording_callback_url

        payload = self._post(f"{self._texml_base}/Calls", data)
        return CallHandle(
            sid=payload.get("sid") or payload.get("call_sid", ""),
            status=payload.get("status", "queued"),
            raw=payload,
        )

    def hangup(self, sid: str) -> None:
        self._post(f"{self._texml_base}/Calls/{sid}", {"Status": "completed"},
                   tolerate_404=True)

    def redirect(self, sid: str, *, twiml: str | None = None,
                 url: str | None = None) -> None:
        if not twiml and not url:
            raise ValueError("redirect requires twiml or url")
        data = {"Twiml": twiml} if twiml else {"Url": url, "Method": "POST"}
        self._post(f"{self._texml_base}/Calls/{sid}", data, tolerate_404=True)

    def fetch_call(self, sid: str) -> dict:
        response = requests.get(
            f"{self._texml_base}/Calls/{sid}", headers=self._headers, timeout=TIMEOUT
        )
        if response.status_code == 404:
            return {}
        self._raise_for_status(response)
        return response.json()

    # --- inbound --------------------------------------------------------
    def verify_signature(self, *, url: str, body: bytes, headers) -> bool:
        """
        Ed25519 over "timestamp|body", per Telnyx's webhook signing scheme.

        The timestamp is checked against WEBHOOK_MAX_SKEW_SECONDS before the
        signature is verified: a valid signature on a six-hour-old body is a
        replay, and verifying it first would make the replay window unbounded.
        """
        signature = headers.get("telnyx-signature-ed25519") or headers.get(
            "Telnyx-Signature-Ed25519", ""
        )
        timestamp = headers.get("telnyx-timestamp") or headers.get(
            "Telnyx-Timestamp", ""
        )
        if not signature or not timestamp or not settings.TELNYX_PUBLIC_KEY:
            return False

        try:
            age = abs(time.time() - float(timestamp))
        except ValueError:
            return False
        if age > settings.WEBHOOK_MAX_SKEW_SECONDS:
            logger.warning("telnyx webhook outside skew window", extra={"age": age})
            return False

        try:
            from nacl.exceptions import BadSignatureError
            from nacl.signing import VerifyKey

            key = VerifyKey(base64.b64decode(settings.TELNYX_PUBLIC_KEY))
            key.verify(
                f"{timestamp}|".encode() + body,
                base64.b64decode(signature),
            )
            return True
        except (BadSignatureError, ValueError, TypeError):
            return False
        except ImportError:  # pragma: no cover
            logger.error("PyNaCl is not installed; cannot verify Telnyx signatures")
            return False

    # --- helpers --------------------------------------------------------
    def _post(self, url: str, data: dict, *, tolerate_404: bool = False) -> dict:
        try:
            response = requests.post(
                url, data=data, headers=self._headers, timeout=TIMEOUT
            )
        except requests.Timeout as exc:
            raise ProviderCallError("Telnyx request timed out", retryable=True) from exc
        except requests.RequestException as exc:
            raise ProviderCallError(str(exc), retryable=True) from exc

        if response.status_code == 404 and tolerate_404:
            return {}
        self._raise_for_status(response)
        try:
            return response.json()
        except ValueError:
            return {}

    @staticmethod
    def _raise_for_status(response):
        if response.ok:
            return
        detail = response.text[:500]
        code = ""
        try:
            errors = response.json().get("errors") or []
            if errors:
                code = str(errors[0].get("code", ""))
                detail = errors[0].get("detail", detail)
        except ValueError:
            pass

        if response.status_code == 429:
            raise ProviderRateLimited(
                detail,
                code=code,
                status=429,
                retry_after=float(response.headers.get("Retry-After", 1)),
            )
        raise ProviderCallError(
            detail,
            code=code,
            status=response.status_code,
            retryable=response.status_code >= 500,
        )
