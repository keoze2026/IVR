"""
`/api/v1/me/` — the caller's identity and capabilities.

This endpoint gates the entire operator portal. The client asks it what the
caller may do and hides everything it does not answer with, so an empty or
wrong capability list is not a cosmetic problem: an operator is shown a portal
with no buttons, or an analyst is offered a Launch control that can only 403.

The capability values are asserted against ROLE_CAPABILITIES rather than
hard-coded here, because the point is that the client no longer keeps its own
copy of the matrix. A literal list in this file would be a third copy to drift.
"""

import pytest

pytestmark = pytest.mark.django_db


@pytest.fixture
def org(db):
    from apps.accounts.models import Organization

    return Organization.objects.create(
        name="Acme", slug="acme-me", max_cps=7.5,
        max_concurrent_channels=42, max_contacts=1234,
    )


def client_for(org, role):
    from rest_framework.test import APIClient

    from apps.accounts.models import APIKey

    _key, raw = APIKey.generate(org, f"test-{role}", role=role)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
    return client


class TestIdentity:
    def test_unauthenticated_is_refused(self, db):
        from rest_framework.test import APIClient

        assert APIClient().get("/api/v1/me/").status_code in (401, 403)

    def test_reports_the_organisation_and_role(self, org):
        from apps.accounts.models import Role

        body = client_for(org, Role.OWNER).get("/api/v1/me/").json()
        assert body["role"] == "owner"
        assert body["organization"]["slug"] == "acme-me"
        assert body["organization"]["is_suspended"] is False

    def test_an_api_key_has_no_user(self, org):
        """There is no human behind a machine credential, and inventing one
        would put a fictitious name in the audit trail."""
        from apps.accounts.models import Role

        body = client_for(org, Role.OWNER).get("/api/v1/me/").json()
        assert body["user"] is None
        assert body["api_key"]["name"] == "test-owner"
        assert body["api_key"]["prefix"].startswith("ivrk_")

    def test_the_key_itself_is_never_returned(self, org):
        """The response identifies the key; it must not restate the secret."""
        from apps.accounts.models import Role

        raw_body = client_for(org, Role.OWNER).get("/api/v1/me/").content.decode()
        assert "key_hash" not in raw_body
        # The prefix is the first 12 characters and is safe; a full-length key
        # appearing here would mean the secret had leaked into the response.
        assert len(
            [w for w in raw_body.split('"') if w.startswith("ivrk_") and len(w) > 20]
        ) == 0

    def test_ceilings_come_from_the_organisation(self, org):
        from apps.accounts.models import Role

        body = client_for(org, Role.OWNER).get("/api/v1/me/").json()
        assert body["ceilings"] == {
            "max_cps": 7.5,
            "max_concurrent_channels": 42,
            "max_contacts": 1234,
        }


class TestCapabilities:
    @pytest.mark.parametrize(
        "role",
        ["owner", "admin", "operator", "analyst", "compliance"],
    )
    def test_every_role_matches_the_server_matrix(self, org, role):
        from apps.accounts.models import ROLE_CAPABILITIES

        body = client_for(org, role).get("/api/v1/me/").json()
        assert set(body["capabilities"]) == set(ROLE_CAPABILITIES[role])

    def test_no_role_reports_an_empty_capability_list(self, org):
        """An empty list makes the portal hide every control, which reads to
        the user as a broken page rather than as a permissions boundary."""
        for role in ["owner", "admin", "operator", "analyst", "compliance"]:
            body = client_for(org, role).get("/api/v1/me/").json()
            assert body["capabilities"], f"{role} received no capabilities"

    def test_an_analyst_cannot_control_campaigns(self, org):
        body = client_for(org, "analyst").get("/api/v1/me/").json()
        assert "campaign.view" in body["capabilities"]
        assert "campaign.control" not in body["capabilities"]
        assert "flow.edit" not in body["capabilities"]

    def test_compliance_may_stop_a_campaign_but_not_edit_one(self, org):
        """The asymmetry the portal relies on to show Stop without Save."""
        body = client_for(org, "compliance").get("/api/v1/me/").json()
        assert "campaign.control" in body["capabilities"]
        assert "campaign.edit" not in body["capabilities"]


class TestTenantIsolation:
    def test_a_key_never_reports_another_organisation(self, org, db):
        from apps.accounts.models import Organization, Role

        Organization.objects.create(name="Other", slug="other-me")
        body = client_for(org, Role.OWNER).get("/api/v1/me/").json()
        assert body["organization"]["slug"] == "acme-me"
