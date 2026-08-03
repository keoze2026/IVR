"""
Uniform API error envelope (spec 11.3).

Every error the API emits has the same shape so the frontend has exactly one
error path:

    {
      "error": {
        "code": "compliance_blocked",
        "message": "Campaign cannot start: 3 contacts lack a consent record",
        "detail": {...},
        "request_id": "..."
      }
    }
"""

import logging
import uuid

from django.core.exceptions import PermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger("ivr.api")


class ComplianceError(APIException):
    """A compliance control refused the operation. Never auto-retryable."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_detail = "Blocked by a compliance control."
    default_code = "compliance_blocked"


class InvalidFlowError(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "IVR flow definition is invalid."
    default_code = "invalid_flow"


class CampaignStateError(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Campaign is not in a state that allows this transition."
    default_code = "invalid_state_transition"


class ProviderError(APIException):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = "Carrier rejected the request."
    default_code = "provider_error"


def api_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = APIException(detail=exc.messages, code="validation_error")
        exc.status_code = status.HTTP_400_BAD_REQUEST
    if isinstance(exc, Http404):
        exc = APIException(detail="Not found.", code="not_found")
        exc.status_code = status.HTTP_404_NOT_FOUND
    if isinstance(exc, PermissionDenied):
        exc = APIException(detail="Permission denied.", code="permission_denied")
        exc.status_code = status.HTTP_403_FORBIDDEN

    response = drf_exception_handler(exc, context)
    request = context.get("request")
    request_id = getattr(request, "request_id", None) or str(uuid.uuid4())

    if response is None:
        logger.exception("Unhandled API exception", extra={"request_id": request_id})
        return Response(
            {
                "error": {
                    "code": "internal_error",
                    "message": "An unexpected error occurred.",
                    "request_id": request_id,
                }
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    detail = response.data
    code = getattr(exc, "default_code", "error")
    message = None
    if isinstance(detail, str):
        message = detail
    elif isinstance(detail, dict):
        message = detail.get("detail")
    if message is None:
        message = str(exc)

    response.data = {
        "error": {
            "code": code,
            "message": message,
            "detail": detail if not isinstance(detail, str) else None,
            "request_id": request_id,
        }
    }
    return response
