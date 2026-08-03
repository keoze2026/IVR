"""IVR flow endpoints (spec 11.2)."""

from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import HasCapability, IsOrganizationMember
from apps.common.mixins import AuditedActionMixin, TenantViewSetMixin
from apps.common.pagination import SmallPageNumberPagination
from apps.common.utils import acting_user
from apps.ivr.models import IVRFlow, IVRFlowVersion
from apps.ivr.serializers import (
    FlowValidationSerializer,
    IVRFlowSerializer,
    IVRFlowVersionSerializer,
)
from apps.ivr.services import known_variables_for, publish_version, validate_version


class IVRFlowViewSet(TenantViewSetMixin, AuditedActionMixin, viewsets.ModelViewSet):
    """/api/v1/flows/"""

    queryset = IVRFlow.objects.all().prefetch_related("versions")
    serializer_class = IVRFlowSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["is_archived"]

    required_capabilities = {
        "list": "flow.view",
        "retrieve": "flow.view",
        "create": "flow.edit",
        "update": "flow.edit",
        "partial_update": "flow.edit",
        "destroy": "flow.edit",
        "versions": "flow.view",
        "validate_definition": "flow.view",
        "node_types": "flow.view",
        "default": "flow.view",
    }

    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        flow = self.get_object()
        versions = flow.versions.order_by("-version")
        return Response(IVRFlowVersionSerializer(versions, many=True).data)

    @action(detail=False, methods=["post"], url_path="validate")
    def validate_definition(self, request):
        """
        Full validation without saving — what the visual builder calls on every
        change so an author sees a dangling transition immediately rather than
        at publish.
        """
        body = FlowValidationSerializer(data=request.data)
        body.is_valid(raise_exception=True)

        from apps.ivr.validators import validate_flow

        result = validate_flow(
            body.validated_data["definition"],
            organization_id=request.organization.pk,
            known_variables=known_variables_for(
                body.validated_data.get("contact_list_ids") or []
            ) or None,
        )
        return Response(result.as_dict())

    @action(detail=False, methods=["get"], url_path="node-types")
    def node_types(self, request):
        """Machine-readable node catalogue, so the builder is never out of date."""
        from apps.ivr.dsl import BRANCH_OPERATORS, NODE_SPECS, PROMPT_KINDS

        return Response({
            "prompt_kinds": sorted(PROMPT_KINDS),
            "branch_operators": sorted(BRANCH_OPERATORS),
            "nodes": [
                {
                    "type": spec.type,
                    "required": sorted(spec.required),
                    "optional": sorted(spec.optional),
                    "transitions": list(spec.transitions),
                    "terminal": spec.terminal,
                    "gathers_input": spec.gathers_input,
                    "description": spec.description,
                }
                for spec in NODE_SPECS.values()
            ],
        })


class IVRFlowVersionViewSet(TenantViewSetMixin, AuditedActionMixin,
                            viewsets.ModelViewSet):
    """/api/v1/flow-versions/"""

    queryset = IVRFlowVersion.objects.all().select_related("flow")
    serializer_class = IVRFlowVersionSerializer
    permission_classes = [IsOrganizationMember, HasCapability]
    pagination_class = SmallPageNumberPagination
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["flow", "is_published"]

    required_capabilities = {
        "list": "flow.view",
        "retrieve": "flow.view",
        "create": "flow.edit",
        "update": "flow.edit",
        "partial_update": "flow.edit",
        "destroy": "flow.edit",
        "publish": "flow.publish",
        "validate_version": "flow.view",
        "clone": "flow.edit",
        "render_prompts": "flow.publish",
        "default": "flow.view",
    }

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        """
        Freeze this version and pre-render its prompts.

        Publication is irreversible by design: campaigns pin a version so that
        editing a flow never changes the behaviour of calls already in flight.
        """
        version = publish_version(
            self.get_object(),
            user=acting_user(request),
        )
        self.audit("flow.publish", version, version=version.version,
                   flow=str(version.flow_id))
        return Response(self.get_serializer(version).data)

    @action(detail=True, methods=["get"], url_path="validate")
    def validate_version(self, request, pk=None):
        return Response(validate_version(self.get_object()))

    @action(detail=True, methods=["post"])
    def clone(self, request, pk=None):
        """Start a new editable draft from this version."""
        from apps.ivr.services import clone_for_edit

        draft = clone_for_edit(
            self.get_object(),
            user=acting_user(request),
        )
        self.audit("flow.clone", draft, source_version=str(pk))
        return Response(self.get_serializer(draft).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="render-prompts")
    def render_prompts(self, request, pk=None):
        from apps.ivr.tasks import render_flow_prompts_task

        version = self.get_object()
        task = render_flow_prompts_task.delay(
            str(version.pk), bool(request.data.get("force", False))
        )
        return Response({"job_id": task.id, "status": "queued"},
                        status=status.HTTP_202_ACCEPTED)

    def destroy(self, request, *args, **kwargs):
        from apps.common.exceptions import CampaignStateError

        version = self.get_object()
        if version.is_published and version.campaigns.exists():
            raise CampaignStateError(
                detail="This version is pinned by one or more campaigns."
            )
        return super().destroy(request, *args, **kwargs)
