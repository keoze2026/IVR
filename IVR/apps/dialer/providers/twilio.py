"""Twilio Programmable Voice adapter."""

from __future__ import annotations

import functools
import logging

from django.conf import settings

from apps.dialer.providers.base import (
    CallHandle,
    OriginateRequest,
    ProviderAdapter,
    ProviderCallError,
    ProviderRateLimited,
)

logger = logging.getLogger("ivr.dialer")

#: Twilio errors that mean "this number will never work". Retrying them wastes
#: attempts and, for 13225/21217, looks like scanning to the carrier.
PERMANENT_ERRORS = {
    "13224",  # number not valid / not routable
    "13225",  # call blocked by Twilio
    "21215",  # geo permission not enabled
    "21217",  # phone number not valid
    "21219",  # unverified number (trial)
    "21610",  # recipient opted out
}


class TwilioAdapter(ProviderAdapter):
    name = "twilio"

    @functools.cached_property
    def client(self):
        from twilio.rest import Client

        # API key + secret is preferred over the account auth token: it can be
        # rotated and scoped without invalidating webhook signature validation,
        # which is keyed on the auth token.
        if settings.TWILIO_API_KEY_SID and settings.TWILIO_API_KEY_SECRET:
            return Client(
                settings.TWILIO_API_KEY_SID,
                settings.TWILIO_API_KEY_SECRET,
                settings.TWILIO_ACCOUNT_SID,
            )
        return Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)

    # --- outbound -------------------------------------------------------
    def place_call(self, request: OriginateRequest) -> CallHandle:
        from twilio.base.exceptions import TwilioRestException

        params = {
            "to": request.to,
            "from_": request.from_,
            "url": request.answer_url,
            "method": "POST",
            "status_callback": request.status_callback_url,
            "status_callback_method": "POST",
            # `initiated` and `ringing` are requested because ring time is the
            # first thing to look at when answer rates fall off a cliff.
            "status_callback_event": ["initiated", "ringing", "answered", "completed"],
            "timeout": request.ring_timeout,
        }

        if request.amd_enabled:
            params["machine_detection"] = (
                "DetectMessageEnd" if request.amd_mode == "DetectMessageEnd"
                else "Enable"
            )
            params["machine_detection_timeout"] = request.amd_timeout
            params["machine_detection_speech_threshold"] = (
                request.machine_detection_speech_threshold
            )
            if request.amd_async and request.amd_callback_url:
                params["async_amd"] = "true"
                params["async_amd_status_callback"] = request.amd_callback_url
                params["async_amd_status_callback_method"] = "POST"

        if request.record:
            params["record"] = True
            params["recording_channels"] = "dual"
            if request.recording_callback_url:
                params["recording_status_callback"] = request.recording_callback_url
                params["recording_status_callback_method"] = "POST"

        if request.caller_name:
            params["caller_id"] = request.caller_name

        try:
            call = self.client.calls.create(**params)
        except TwilioRestException as exc:
            raise self._translate(exc) from exc

        return CallHandle(sid=call.sid, status=call.status or "queued")

    def hangup(self, sid: str) -> None:
        from twilio.base.exceptions import TwilioRestException

        try:
            self.client.calls(sid).update(status="completed")
        except TwilioRestException as exc:
            if exc.status == 404:
                return  # already gone; nothing to do
            raise self._translate(exc) from exc

    def redirect(self, sid: str, *, twiml: str | None = None,
                 url: str | None = None) -> None:
        from twilio.base.exceptions import TwilioRestException

        if not twiml and not url:
            raise ValueError("redirect requires twiml or url")
        try:
            self.client.calls(sid).update(
                **({"twiml": twiml} if twiml else {"url": url, "method": "POST"})
            )
        except TwilioRestException as exc:
            # A 404 here is the normal race: the caller hung up between the AMD
            # result and our redirect. Not an error worth alerting on.
            if exc.status in (404, 409):
                logger.info("redirect raced with call end", extra={"sid": sid})
                return
            raise self._translate(exc) from exc

    def fetch_call(self, sid: str) -> dict:
        from twilio.base.exceptions import TwilioRestException

        try:
            call = self.client.calls(sid).fetch()
        except TwilioRestException as exc:
            raise self._translate(exc) from exc
        return {
            "sid": call.sid,
            "status": call.status,
            "duration": int(call.duration or 0),
            "price": call.price,
            "price_unit": call.price_unit,
            "answered_by": getattr(call, "answered_by", ""),
            "start_time": call.start_time,
            "end_time": call.end_time,
        }

    # --- lookup ---------------------------------------------------------
    def lookup_numbers(self, numbers: list[str]) -> dict[str, dict]:
        """
        Line-type lookup, one request per number (Twilio Lookup has no batch
        endpoint). Called from the maintenance queue precisely because it is
        slow and billable — never from the dial path.
        """
        from twilio.base.exceptions import TwilioRestException

        out: dict[str, dict] = {}
        for number in numbers:
            try:
                result = self.client.lookups.v2.phone_numbers(number).fetch(
                    fields="line_type_intelligence"
                )
                info = result.line_type_intelligence or {}
                out[number] = {
                    "line_type": info.get("type", ""),
                    "carrier_name": info.get("carrier_name", ""),
                    "invalid": not result.valid,
                }
            except TwilioRestException as exc:
                if exc.status == 404:
                    out[number] = {"invalid": True}
                else:
                    logger.warning("lookup failed", extra={"code": str(exc.code)})
        return out

    # --- inbound --------------------------------------------------------
    def verify_signature(self, *, url: str, body: bytes, headers) -> bool:
        from twilio.request_validator import RequestValidator

        signature = headers.get("X-Twilio-Signature", "")
        if not signature or not settings.TWILIO_AUTH_TOKEN:
            return False

        validator = RequestValidator(settings.TWILIO_AUTH_TOKEN)
        params = _form_params(body, headers)
        # Twilio signs form-encoded bodies over sorted params, and JSON bodies
        # over the raw body appended to the URL. Both shapes appear depending
        # on which callback fired.
        if params is not None:
            return validator.validate(url, params, signature)
        return validator.validate(url, body.decode("utf-8", "replace"), signature)

    # --- helpers --------------------------------------------------------
    @staticmethod
    def _translate(exc) -> ProviderCallError:
        code = str(getattr(exc, "code", "") or "")
        status = int(getattr(exc, "status", 0) or 0)
        if status == 429:
            return ProviderRateLimited(str(exc), code=code, status=status,
                                       retry_after=1.0)
        retryable = status >= 500 or (status == 0 and not code)
        if code in PERMANENT_ERRORS:
            retryable = False
        return ProviderCallError(str(exc), code=code, status=status,
                                 retryable=retryable)


def _form_params(body: bytes, headers) -> dict | None:
    content_type = (headers.get("Content-Type") or "").split(";")[0].strip()
    if content_type != "application/x-www-form-urlencoded":
        return None
    from urllib.parse import parse_qsl

    return dict(parse_qsl(body.decode("utf-8", "replace")))
