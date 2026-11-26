"""The live campaign socket accepts a signed-in person, not only an API key."""

import pytest

from apps.accounts.authentication import issue_user_token
from apps.accounts.models import Organization, User
from apps.telemetry.middleware import resolve_user_token

pytestmark = pytest.mark.django_db


@pytest.fixture
def person():
    org = Organization.objects.create(name="Acme", slug="acme")
    return User.objects.create_user(
        username="jane", password="abc12", organization=org, role="operator"
    )


def test_a_signed_in_person_is_recognised(person):
    user, organization = resolve_user_token(issue_user_token(person))

    assert (user.pk, organization.pk) == (person.pk, person.organization_id)


def test_a_token_stops_working_when_the_code_is_reset(person):
    token = issue_user_token(person)
    person.set_password("new99")
    person.save()

    assert resolve_user_token(token) == (None, None)


def test_a_blocked_person_is_refused(person):
    token = issue_user_token(person)
    User.objects.filter(pk=person.pk).update(is_active=False)

    assert resolve_user_token(token) == (None, None)


def test_a_forged_token_is_refused(person):
    assert resolve_user_token("ivrt_not-a-real-token") == (None, None)
