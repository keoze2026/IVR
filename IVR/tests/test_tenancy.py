"""
The tenancy guard (spec 1.1, 3.1).

A missing organisation filter is a data-breach class defect, not a bug. These
tests assert that the guard actually fires — a guard nobody has verified is
worse than no guard, because it justifies not checking.
"""

import pytest

pytestmark = pytest.mark.django_db


@pytest.fixture
def two_orgs(db):
    from apps.accounts.models import Organization

    a = Organization.objects.create(name="Alpha", slug="alpha")
    b = Organization.objects.create(name="Beta", slug="beta")
    return a, b


@pytest.fixture
def lists(two_orgs):
    from apps.contacts.models import ContactList

    a, b = two_orgs
    return (
        ContactList.objects.create(organization=a, name="Alpha list"),
        ContactList.objects.create(organization=b, name="Beta list"),
    )


class TestGuard:
    def test_unscoped_access_raises_in_strict_mode(self, settings, lists):
        from apps.common.models import UnscopedTenantQueryError
        from apps.contacts.models import ContactList

        settings.TENANCY_STRICT = True
        with pytest.raises(UnscopedTenantQueryError):
            list(ContactList.objects.all())

    def test_for_org_scopes_correctly(self, two_orgs, lists, settings):
        from apps.contacts.models import ContactList

        settings.TENANCY_STRICT = True
        alpha, _beta = two_orgs
        rows = list(ContactList.objects.for_org(alpha))
        assert [r.name for r in rows] == ["Alpha list"]

    def test_explicit_organization_filter_counts_as_scoped(self, two_orgs,
                                                           lists, settings):
        from apps.contacts.models import ContactList

        settings.TENANCY_STRICT = True
        alpha, _beta = two_orgs
        rows = list(ContactList.objects.filter(organization=alpha))
        assert len(rows) == 1

    def test_unscoped_escape_hatch_works(self, lists, settings):
        from apps.contacts.models import ContactList

        settings.TENANCY_STRICT = True
        assert len(list(ContactList.objects.unscoped())) == 2

    def test_related_manager_access_is_implicitly_scoped(self, two_orgs, settings):
        """`contact_list.contacts.all()` is already constrained by the FK."""
        from apps.contacts.models import Contact, ContactList

        settings.TENANCY_STRICT = True
        alpha, _ = two_orgs
        clist = ContactList.objects.create(organization=alpha, name="L")
        Contact.objects.create(
            organization=alpha, contact_list=clist,
            phone_e164="+12125550123", phone_hash="a" * 64,
        )
        assert clist.contacts.count() == 1

    def test_count_and_exists_are_guarded_too(self, settings, lists):
        from apps.common.models import UnscopedTenantQueryError
        from apps.contacts.models import ContactList

        settings.TENANCY_STRICT = True
        with pytest.raises(UnscopedTenantQueryError):
            ContactList.objects.count()
        with pytest.raises(UnscopedTenantQueryError):
            ContactList.objects.exists()

    def test_logs_instead_of_raising_when_not_strict(self, settings, lists, caplog):
        """Production logs critical rather than 500-ing an operator's page."""
        from apps.contacts.models import ContactList

        settings.TENANCY_STRICT = False
        with caplog.at_level("CRITICAL", logger="ivr.tenancy"):
            list(ContactList.objects.all())
        assert any("Unscoped queryset" in r.message for r in caplog.records)
