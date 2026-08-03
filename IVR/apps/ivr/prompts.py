"""
Prompt pre-rendering (spec 6.4).

Rendering speech at call time adds latency to every answer, costs money per
call, and makes each call a live dependency on a third-party API that will
eventually have a bad afternoon. So `tts` prompts are synthesised once per
(flow version, locale) at publish time and served as <Play> from S3.

The exception is prompts containing merge variables. Those genuinely differ per
contact and cannot be pre-rendered as a unit; they are marked DYNAMIC and fall
back to live <Say>. The validator already warns when a `say` prompt has no
variables (pointless live synthesis); this module marks the inverse case so the
runtime does not log a spurious "not pre-rendered" warning on every call.

A note on synthetic voice and consent
-------------------------------------
Using an artificial or pre-recorded voice is the specific characteristic that
brings a call under the stricter US consent rules — it is not a detail of the
audio pipeline. Pre-rendering to S3 does not change the legal character of the
call: every prompt in this module is an artificial voice whether it is
synthesised at publish time or at call time. The consent gate in
compliance.services is what governs whether it may be played at all.
"""

from __future__ import annotations

import hashlib
import logging

from django.conf import settings

from apps.common.storage import put_bytes
from apps.ivr.dsl import merge_tokens

logger = logging.getLogger("ivr.compliance")

#: Marker stored in rendered_prompts for prompts that must be spoken live.
DYNAMIC = "__dynamic__"

PROMPT_SLOTS = ("prompt", "invalid_prompt", "timeout_prompt", "whisper",
                "ring_prompt")


def collect_prompts(definition: dict) -> list[tuple[str, str, dict]]:
    """Yield (node_id, slot, prompt) for every TTS prompt in a flow."""
    out = []
    for node_id, node in (definition.get("nodes") or {}).items():
        for slot in PROMPT_SLOTS:
            prompt = node.get(slot)
            if isinstance(prompt, dict) and prompt.get("kind") == "tts":
                out.append((node_id, slot, prompt))
    return out


def render_key(text: str, voice: str, engine: str, locale: str) -> str:
    return hashlib.sha256(
        "\x1f".join([text, voice, engine, locale]).encode("utf-8")
    ).hexdigest()


def synthesize(text: str, *, locale: str, voice: str | None = None) -> tuple[bytes, str]:
    """Return (audio_bytes, mime_type). Dispatches on settings.TTS_PROVIDER."""
    provider = (settings.TTS_PROVIDER or "polly").lower()
    if provider == "polly":
        return _polly(text, locale=locale, voice=voice)
    if provider == "elevenlabs":
        return _elevenlabs(text, voice=voice)
    raise ValueError(f"Unknown TTS provider {provider!r}")


def _polly(text: str, *, locale: str, voice: str | None) -> tuple[bytes, str]:
    import boto3

    client = boto3.client("polly", region_name=settings.AWS_S3_REGION_NAME)
    response = client.synthesize_speech(
        Text=text,
        OutputFormat="mp3",
        VoiceId=voice or settings.POLLY_VOICE_ID,
        Engine=settings.POLLY_ENGINE,
        # 8 kHz is the telephony sample rate; synthesising at 22 kHz only to
        # have the carrier downsample it wastes bytes and adds nothing.
        SampleRate="8000",
    )
    return response["AudioStream"].read(), "audio/mpeg"


def _elevenlabs(text: str, *, voice: str | None) -> tuple[bytes, str]:
    import requests

    voice_id = voice or settings.ELEVENLABS_VOICE_ID
    if not (settings.ELEVENLABS_API_KEY and voice_id):
        raise RuntimeError("ElevenLabs credentials or voice id are not configured")
    response = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={
            "xi-api-key": settings.ELEVENLABS_API_KEY,
            "accept": "audio/mpeg",
        },
        json={"text": text, "model_id": "eleven_turbo_v2"},
        timeout=30,
    )
    response.raise_for_status()
    return response.content, "audio/mpeg"


def render_flow_prompts(flow_version, *, force: bool = False) -> dict:
    """
    Render every TTS prompt in a flow version and return the rendered_prompts map:

        {"<node_id>:<slot>": {"en": "prompts/<org>/<version>/<hash>.mp3"}}
    """
    definition = flow_version.definition or {}
    locales = definition.get("locales") or [definition.get("default_locale", "en")]
    existing = dict(flow_version.rendered_prompts or {}) if not force else {}

    rendered: dict[str, dict] = {}
    stats = {"rendered": 0, "reused": 0, "dynamic": 0, "failed": 0}

    for node_id, slot, prompt in collect_prompts(definition):
        key = f"{node_id}:{slot}"
        text = prompt.get("text", "")
        voice = prompt.get("voice") or None

        if merge_tokens(text):
            rendered[key] = {locale: DYNAMIC for locale in locales}
            stats["dynamic"] += 1
            continue

        per_locale = {}
        for locale in locales:
            previous = (existing.get(key) or {}).get(locale)
            if previous and previous != DYNAMIC:
                per_locale[locale] = previous
                stats["reused"] += 1
                continue
            try:
                audio, mime = synthesize(text, locale=locale, voice=voice)
            except Exception:  # noqa: BLE001 — one bad prompt must not block publish
                logger.exception(
                    "prompt synthesis failed",
                    extra={"node": node_id, "slot": slot, "locale": locale},
                )
                stats["failed"] += 1
                continue
            digest = render_key(text, voice or settings.POLLY_VOICE_ID,
                                settings.POLLY_ENGINE, locale)
            s3_key = (
                f"prompts/{flow_version.organization_id}/{flow_version.pk}/"
                f"{digest}.{'mp3' if mime == 'audio/mpeg' else 'wav'}"
            )
            put_bytes(settings.S3_BUCKET_PROMPTS, s3_key, audio, mime)
            per_locale[locale] = s3_key
            stats["rendered"] += 1
        if per_locale:
            rendered[key] = per_locale

    return {"rendered_prompts": rendered, "stats": stats}
