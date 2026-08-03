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


def _unscoped_unique_validators():
    """Every DRF uniqueness validator still pointing at a guarded queryset.

    DRF derives these from the model's unique constraints and binds them to
    ``_default_manager``, which on a tenant model is the guarded one. Each hit
    is a 500 on a duplicate value that should have been a 400.
    """
    import importlib
    import inspect

    from rest_framework import serializers
    from rest_framework.validators import UniqueTogetherValidator, UniqueValidator

    from apps.common.models import TenantManager, TenantModel, TenantQuerySet

    def is_guarded(qs):
        if isinstance(qs, TenantManager):
            return True
        return isinstance(qs, TenantQuerySet) and not qs._tenant_scoped

    offenders = []
    for app in ("accounts", "campaigns", "compliance", "contacts", "ivr", "telephony"):
        try:
            module = importlib.import_module(f"apps.{app}.serializers")
        except ModuleNotFoundError:
            continue
        for name, cls in vars(module).items():
            if not (inspect.isclass(cls)
                    and issubclass(cls, serializers.ModelSerializer)):
                continue
            model = getattr(getattr(cls, "Meta", None), "model", None)
            if not (model and issubclass(model, TenantModel)):
                continue
            instance = cls()
            for validator in instance.validators:
                if isinstance(validator, UniqueTogetherValidator) \
                        and is_guarded(validator.queryset):
                    offenders.append(f"{app}.{name} unique_together"
                                     f"{tuple(validator.fields)}")
            for field_name, field in instance.fields.items():
                for validator in getattr(field, "validators", []):
                    if isinstance(validator, UniqueValidator) \
                            and is_guarded(validator.queryset):
                        offenders.append(f"{app}.{name}.{field_name}")
    return offenders


class TestSerialiserUniqueness:
    """Regression: a duplicate value must be a 400, not a tenancy-guard 500."""

    def test_no_serialiser_checks_uniqueness_on_a_guarded_queryset(self):
        offenders = _unscoped_unique_validators()
        assert not offenders, (
            "these need apps.common.serializers.UnscopedUniqueValidatorsMixin: "
            + ", ".join(offenders)
        )

    def test_duplicate_caller_id_reports_a_validation_error(self, two_orgs, settings):
        """The original 500: DRF's UniqueValidator hitting the guard."""
        from apps.campaigns.models import CallerID
        from apps.campaigns.serializers import CallerIDSerializer

        settings.TENANCY_STRICT = True
        alpha, beta = two_orgs
        CallerID.objects.create(
            organization=alpha, phone_e164="+15005550006", provider="twilio"
        )
        # Claimed by another tenant: must be reported, not raised, and the
        # cross-tenant row must be visible to the check or it would slip through.
        serializer = CallerIDSerializer(
            data={"phone_e164": "+15005550006", "provider": "twilio"}
        )
        assert not serializer.is_valid()
        assert "phone_e164" in serializer.errors


class TestCrossTenantReferences:
    """A tenant must not be able to name another tenant's row in a request body.

    `get_queryset` scopes what a request can read; it does nothing about the
    primary keys the body supplies. DRF builds relational fields against the
    target model's default manager, unfiltered, so this was accepted until
    `TenantViewSetMixin.get_serializer` began scoping them.

    Asserted with TENANCY_STRICT off, which is the production setting: the
    tenancy guard raises in dev and would mask the hole being tested.
    """

    @pytest.fixture
    def api(self):
        from rest_framework.test import APIClient

        return APIClient()

    @pytest.fixture
    def victim_objects(self, two_orgs):
        """Rows belonging entirely to org B."""
        from apps.campaigns.models import CallerID
        from apps.contacts.models import ContactList
        from apps.ivr.models import IVRFlow, IVRFlowVersion

        _alpha, beta = two_orgs
        flow = IVRFlow.objects.create(organization=beta, name="Beta flow")
        return {
            "caller_id": CallerID.objects.create(
                organization=beta, phone_e164="+15005559999", provider="twilio"
            ),
            "contact_list": ContactList.objects.create(
                organization=beta, name="Beta private list"
            ),
            "flow_version": IVRFlowVersion.objects.create(
                organization=beta, flow=flow, version=1, is_published=True,
                definition={"schema_version": "1.0", "entry": "x", "nodes": {}},
            ),
        }

    @staticmethod
    def _key_for(org):
        from apps.accounts.models import APIKey, Role

        _key, raw = APIKey.generate(org, "test", role=Role.OWNER)
        return raw

    def test_campaign_cannot_reference_another_orgs_rows(
        self, settings, two_orgs, victim_objects, api
    ):
        settings.TENANCY_STRICT = False
        alpha, _beta = two_orgs
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {self._key_for(alpha)}")

        response = api.post("/api/v1/campaigns/", {
            "name": "Stolen",
            "flow_version": str(victim_objects["flow_version"].id),
            "caller_id": str(victim_objects["caller_id"].id),
            "contact_lists": [str(victim_objects["contact_list"].id)],
            "provider": "twilio",
        }, format="json")

        assert response.status_code == 400, (
            f"cross-tenant reference accepted ({response.status_code}); org A "
            f"built a campaign from org B's rows"
        )
        body = str(response.data)
        # Every borrowed relation must be rejected, not just the first one.
        for field in ("flow_version", "caller_id", "contact_lists"):
            assert field in body, f"{field} was accepted from another tenant"

    def test_contact_cannot_be_added_to_another_orgs_list(
        self, settings, two_orgs, victim_objects, api
    ):
        settings.TENANCY_STRICT = False
        alpha, _beta = two_orgs
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {self._key_for(alpha)}")

        response = api.post("/api/v1/contacts/", {
            "contact_list": str(victim_objects["contact_list"].id),
            "phone_e164": "+12125550123",
        }, format="json")

        assert response.status_code == 400
        assert "contact_list" in str(response.data)

    def test_own_rows_are_still_accepted(self, settings, two_orgs, api):
        """The scoping must reject the other tenant, not every relation."""
        from apps.contacts.models import ContactList

        settings.TENANCY_STRICT = False
        alpha, _beta = two_orgs
        own_list = ContactList.objects.create(organization=alpha, name="Alpha list")
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {self._key_for(alpha)}")

        response = api.post("/api/v1/contacts/", {
            "contact_list": str(own_list.id),
            "phone_e164": "+12125550123",
        }, format="json")

        assert response.status_code == 201, response.data

    def test_every_tenant_viewset_uses_the_scoping_mixin(self):
        """The fix is structural: a new viewset must not be able to opt out."""
        import importlib
        import inspect

        from rest_framework import viewsets

        from apps.common.mixins import TenantViewSetMixin
        from apps.common.models import TenantModel

        offenders = []
        for app in ("accounts", "campaigns", "compliance", "contacts", "ivr",
                    "telephony"):
            try:
                module = importlib.import_module(f"apps.{app}.views")
            except ModuleNotFoundError:
                continue
            for name, cls in vars(module).items():
                if not (inspect.isclass(cls)
                        and issubclass(cls, viewsets.GenericViewSet)):
                    continue
                model = getattr(getattr(cls, "queryset", None), "model", None)
                if not (model and issubclass(model, TenantModel)):
                    continue
                if not issubclass(cls, TenantViewSetMixin):
                    offenders.append(f"{app}.{name}")
        assert not offenders, (
            "these viewsets serve tenant models without TenantViewSetMixin: "
            + ", ".join(offenders)
        )
