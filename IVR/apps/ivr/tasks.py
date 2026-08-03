"""IVR background tasks."""

from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

from apps.ivr.models import IVRFlowVersion
from apps.ivr.prompts import render_flow_prompts

logger = logging.getLogger("ivr.compliance")


@shared_task(
    bind=True,
    name="ivr.render_flow_prompts",
    queue="maintenance",
    max_retries=3,
    default_retry_delay=30,
)
def render_flow_prompts_task(self, flow_version_id: str, force: bool = False):
    """
    Pre-render every static TTS prompt in a published flow.

    A campaign cannot start until this has completed successfully — otherwise
    the first few hundred calls fall back to live <Say>, which is slower,
    costlier and (with some voices) audibly different from the rest of the
    script.
    """
    version = IVRFlowVersion.objects.unscoped().get(pk=flow_version_id)
    outcome = render_flow_prompts(version, force=force)

    IVRFlowVersion.objects.unscoped().filter(pk=version.pk).update(
        rendered_prompts=outcome["rendered_prompts"],
        prompts_rendered_at=timezone.now(),
    )

    from django.core.cache import cache

    from apps.common.redis_clients import Keys

    cache.delete(Keys.flow_cache(str(version.pk)))

    stats = outcome["stats"]
    if stats["failed"]:
        # Retry the whole render; already-rendered prompts are reused, so a
        # retry only re-attempts the ones that failed.
        raise self.retry(
            exc=RuntimeError(f"{stats['failed']} prompt(s) failed to synthesise")
        )
    logger.info("flow prompts rendered", extra={"version": str(version.pk), **stats})
    return stats


@shared_task(name="ivr.warm_flow_cache", queue="maintenance")
def warm_flow_cache(flow_version_id: str):
    """
    Pull a flow document into the cache before a campaign starts.

    Without this the first N concurrent calls all miss the cache and stampede
    the same row — harmless at 1 CPS, a visible latency spike at 20.
    """
    from apps.ivr.runtime import load_flow

    return bool(load_flow(flow_version_id))
