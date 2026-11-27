"""
Lists, filters and the clock given to toll-free numbers.
"""

import importlib

import pytest
from django.apps import apps as django_apps
from django.db import connection
from rest_framework.test import APIClient

from apps.accounts.models import Organization, User
from apps.campaigns.models import CallerID, Campaign
from apps.contacts.ingest import normalise_phone, parse_row
from apps.contacts.models import Contact, ContactList
from apps.ivr.models import IVRFlow, IVRFlowVersion

pytestmark = pytest.mark.django_db


def organisation(slug: str):
    org = Organization.objects.create(name=slug.title(), slug=slug)
    user = User.objects.create_user(
        username=f"{slug}-owner", password="x", organization=org, role="owner"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return org, client


def jobs(org, count: int) -> list[Campaign]:
    number = CallerID.objects.create(
        organization=org, phone_e164=f"+1213555{org.pk.int % 10000:04}", provider="telnyx"
    )
    flow = IVRFlow.objects.create(organization=org, name="flow")
    version = IVRFlowVersion.objects.create(
        organization=org, flow=flow, version=1, definition={}
    )
    return [
        Campaign.objects.create(
            organization=org, name=f"job {i:03}", caller_id=number, flow_version=version
        )
        for i in range(count)
    ]


# --- toll-free clock --------------------------------------------------------

@pytest.mark.parametrize("number", ["+18005550199", "+18335550199", "+18885550199"])
def test_a_toll_free_number_gets_a_mainland_clock(number):
    assert normalise_phone(number, "US")[2] == "America/Chicago"


def test_an_imported_toll_free_row_gets_the_same_clock():
    assert parse_row({"phone": "(800) 555-0199"}, "US")["timezone"] == "America/Chicago"


def test_a_number_with_a_place_keeps_its_own_clock():
    assert normalise_phone("+12125550123", "US")[2] == "America/New_York"
    assert normalise_phone("+254712345678", "US")[2] == "Africa/Nairobi"


def test_contacts_imported_earlier_are_corrected():
    org, _client = organisation("acme")
    contacts = ContactList.objects.create(organization=org, name="old")
    for phone in ("+18005550199", "+19075550123"):
        Contact.objects.create(
            organization=org, contact_list=contacts, phone_e164=phone,
            phone_hash=phone, timezone="America/Adak",
        )

    migration = importlib.import_module("apps.contacts.migrations.0002_toll_free_timezone")
    with connection.schema_editor() as editor:
        migration.forwards(django_apps, editor)

    stored = dict(Contact.objects.for_org(org).values_list("phone_e164", "timezone"))
    assert stored == {"+18005550199": "America/Chicago", "+19075550123": "America/Adak"}


# --- list order and paging --------------------------------------------------

def test_jobs_are_listed_newest_first_and_every_one_appears_once():
    org, client = organisation("acme")
    created = jobs(org, 30)

    first = client.get("/api/v1/campaigns/").json()
    second = client.get("/api/v1/campaigns/?page=2").json()

    names = [row["name"] for row in first["results"] + second["results"]]
    assert first["count"] == 30
    assert names == [job.name for job in reversed(created)]


# --- filtering by a related record ------------------------------------------

def test_calls_can_be_filtered_by_job_with_the_tenancy_guard_on(settings):
    settings.TENANCY_STRICT = True
    org, client = organisation("acme")
    job = jobs(org, 1)[0]

    response = client.get(f"/api/v1/calls/?campaign={job.id}")

    assert response.status_code == 200, response.content
    assert response.json()["results"] == []


def test_another_organisations_job_cannot_be_named_in_a_filter(settings):
    settings.TENANCY_STRICT = True
    theirs = jobs(organisation("other")[0], 1)[0]
    _org, client = organisation("acme")

    response = client.get(f"/api/v1/calls/?campaign={theirs.id}")

    assert response.status_code == 400
