"""
Writes performed with an API key (spec 12.4).

An API key authenticates as `APIKeyUser`, which duck-types the user contract
so that views need not care how a request was authenticated. It is not a `User`
row, though, and several write paths assigned `request.user` straight to a
`User` foreign key — `AuditLogEntry.actor`, `Campaign.created_by`,
`IVRFlowVersion.published_by`. `APIKeyUser.is_authenticated` is unconditionally
True, so the usual `if request.user.is_authenticated` guard passed and the
assignment raised, turning routine writes into 500s.

Machine credentials are the normal way this API is driven, so these paths are
exercised here the way a caller actually uses them: over HTTP, with a key.
"""

import pytest

pytestmark = pytest.mark.django_db

FLOW_DEFINITION = {
    "schema_version": "1.0",
    "entry": "greeting",
    "default_locale": "en",
    "locales": ["en"],
    "nodes": {
        "greeting": {
            "type": "play",
            "prompt": {"kind": "tts", "text": "Hello."},
            "next": "goodbye",
        },
        "goodbye": {"type": "hangup", "prompt": {"kind": "tts", "text": "Bye."}},
    },
}


@pytest.fixture
def org(db):
    from apps.accounts.models import Organization

    return Organization.objects.create(name="Acme", slug="acme-apikey")


@pytest.fixture
def api(org):
    from rest_framework.test import APIClient

    from apps.accounts.models import APIKey, Role

    _key, raw = APIKey.generate(org, "test", role=Role.OWNER)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
    return client


class TestUserForeignKeys:
    def test_creating_a_flow_version_succeeds(self, api, org):
        from apps.ivr.models import IVRFlow

        flow = IVRFlow.objects.create(organization=org, name="F")
        response = api.post("/api/v1/flow-versions/", {
            "flow": str(flow.id),
            "entry_node": "greeting",
            "definition": FLOW_DEFINITION,
        }, format="json")

        assert response.status_code == 201, response.data
        # No User row is involved, so the column stays empty rather than
        # holding a fabricated one; the API key carries the attribution.
        from apps.ivr.models import IVRFlowVersion
        assert IVRFlowVersion.objects.unscoped().get(
            id=response.data["id"]
        ).published_by is None

    def test_creating_a_campaign_succeeds(self, api, org):
        from apps.campaigns.models import CallerID, Campaign
        from apps.contacts.models import ContactList
        from apps.ivr.models import IVRFlow, IVRFlowVersion

        flow = IVRFlow.objects.create(organization=org, name="F2")
        version = IVRFlowVersion.objects.create(
            organization=org, flow=flow, version=1, is_published=True,
            definition=FLOW_DEFINITION, entry_node="greeting",
        )
        caller_id = CallerID.objects.create(
            organization=org, phone_e164="+15005550111", provider="twilio"
        )
        contact_list = ContactList.objects.create(organization=org, name="L")

        response = api.post("/api/v1/campaigns/", {
            "name": "C", "flow_version": str(version.id),
            "caller_id": str(caller_id.id), "provider": "twilio",
            "contact_lists": [str(contact_list.id)],
        }, format="json")

        assert response.status_code == 201, response.data
        assert Campaign.objects.unscoped().get(
            id=response.data["id"]
        ).created_by is None

    def test_the_action_is_still_attributed_to_the_key(self, api, org):
        """An audit trail that cannot record a key records nothing useful."""
        from apps.accounts.models import AuditLogEntry

        response = api.post("/api/v1/dnc/", {
            "phone_e164": "+12125550188", "reason": "internal_dnc",
        }, format="json")
        assert response.status_code == 201, response.data

        entry = AuditLogEntry.objects.filter(
            organization=org, action="dnc.create"
        ).first()
        assert entry is not None, "no audit entry written for a key-authed write"
        assert entry.actor is None
        assert entry.api_key is not None, "the acting API key was not recorded"


class TestSuppressionIsIdempotent:
    """Re-suppressing a number must not fail.

    The DNC unique constraints are conditional (org-wide vs campaign-scoped),
    which DRF cannot express as a validator, so a repeat add reached the INSERT
    and returned a 500 — on the one path where an error that reads as "it did
    not work" invites a retry that keeps dialling.
    """

    def test_adding_the_same_number_twice_is_accepted(self, api, org):
        from apps.compliance.models import DNCEntry

        payload = {"phone_e164": "+12125550199", "reason": "internal_dnc"}
        first = api.post("/api/v1/dnc/", payload, format="json")
        second = api.post("/api/v1/dnc/", payload, format="json")

        assert first.status_code == 201, first.data
        assert second.status_code == 201, second.data
        assert first.data["id"] == second.data["id"], "a second row was created"
        assert DNCEntry.objects.for_org(org).count() == 1

    def test_a_campaign_scoped_entry_is_distinct_from_the_org_wide_one(
        self, api, org
    ):
        """Idempotency must key on the scope, not collapse the two."""
        from apps.campaigns.models import CallerID, Campaign
        from apps.compliance.models import DNCEntry
        from apps.ivr.models import IVRFlow, IVRFlowVersion

        flow = IVRFlow.objects.create(organization=org, name="F3")
        version = IVRFlowVersion.objects.create(
            organization=org, flow=flow, version=1, is_published=True,
            definition=FLOW_DEFINITION, entry_node="greeting",
        )
        campaign = Campaign.objects.create(
            organization=org, name="C3", flow_version=version,
            caller_id=CallerID.objects.create(
                organization=org, phone_e164="+15005550222", provider="twilio"
            ),
        )

        api.post("/api/v1/dnc/", {
            "phone_e164": "+12125550199", "reason": "internal_dnc",
        }, format="json")
        scoped = api.post("/api/v1/dnc/", {
            "phone_e164": "+12125550199", "reason": "internal_dnc",
            "scope_campaign": str(campaign.id),
        }, format="json")

        assert scoped.status_code == 201, scoped.data
        assert DNCEntry.objects.for_org(org).count() == 2
