"""Flow version lifecycle: draft → validate → publish (spec 6.3)."""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from apps.common.exceptions import InvalidFlowError
from apps.common.utils import stable_checksum
from apps.ivr.models import IVRFlowVersion
from apps.ivr.validators import validate_flow

logger = logging.getLogger("ivr.compliance")


def create_version(flow, definition: dict, *, user=None) -> IVRFlowVersion:
    """
    Create the next draft version of a flow.

    Published versions are immutable, so every edit is a new row. The version
    number is allocated inside a transaction with a row lock on the parent flow
    to avoid two editors colliding on the same number.
    """
    with transaction.atomic():
        locked = type(flow).objects.unscoped().select_for_update().get(pk=flow.pk)
        latest = (
            IVRFlowVersion.objects.unscoped()
            .filter(flow=locked)
            .order_by("-version")
            .values_list("version", flat=True)
            .first()
            or 0
        )
        return IVRFlowVersion.objects.create(
            organization_id=locked.organization_id,
            flow=locked,
            version=latest + 1,
            definition=definition,
            entry_node=definition.get("entry", ""),
            checksum=stable_checksum(definition),
            is_published=False,
            published_by=user,
        )


def validate_version(version: IVRFlowVersion, *, known_variables=None) -> dict:
    result = validate_flow(
        version.definition,
        organization_id=version.organization_id,
        known_variables=known_variables,
    )
    return result.as_dict()


def publish_version(version: IVRFlowVersion, *, user=None,
                    render_prompts: bool = True) -> IVRFlowVersion:
    """
    Validate and freeze a version.

    Publication is the last point at which anything about a flow can be
    checked cheaply. After this, every check costs a live call.
    """
    if version.is_published:
        return version

    report = validate_version(version)
    version.validation_report = report
    if not report["ok"]:
        version.save(update_fields=["validation_report"])
        raise InvalidFlowError(detail=report)

    version.is_published = True
    version.published_at = timezone.now()
    version.published_by = user
    version.checksum = stable_checksum(version.definition)
    version.entry_node = version.definition.get("entry", "")
    version.save(
        update_fields=[
            "is_published", "published_at", "published_by", "checksum",
            "entry_node", "validation_report", "updated_at",
        ]
    )

    if render_prompts:
        from apps.ivr.tasks import render_flow_prompts_task

        render_flow_prompts_task.delay(str(version.pk))

    logger.info(
        "flow version published",
        extra={"flow": str(version.flow_id), "version": version.version,
               "warnings": len(report["warnings"])},
    )
    return version


def clone_for_edit(version: IVRFlowVersion, *, user=None) -> IVRFlowVersion:
    """Start a new draft from a published version."""
    return create_version(version.flow, version.definition, user=user)


def known_variables_for(contact_list_ids) -> set[str]:
    """
    Merge variables actually present in the target lists.

    Used to warn at publish time about prompts referencing a field the uploaded
    CSV does not contain — which renders as an awkward silence mid-sentence on
    every call rather than as an error anyone sees.
    """
    if not contact_list_ids:
        return set()

    from apps.contacts.models import Contact

    names: set[str] = set()
    sample = (
        Contact.objects.unscoped()
        .filter(contact_list_id__in=contact_list_ids)
        .values_list("variables", flat=True)[:200]
    )
    for variables in sample:
        names.update((variables or {}).keys())
    return names
