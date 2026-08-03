"""
Serialiser helpers that reconcile DRF's uniqueness checks with the tenancy
guard in ``apps.common.models``.

DRF builds ``UniqueValidator`` / ``UniqueTogetherValidator`` from the model's
own unique constraints, and it builds them against ``Model._default_manager``.
On a tenant model that manager is the guarded one, so the validator's
``.exists()`` lands in ``TenantQuerySet._check_scoped`` unscoped and raises.
With ``TENANCY_STRICT`` on that turns an ordinary duplicate — a 400 — into a
500, and with it off it writes a CRITICAL log line on a routine validation.

Scoping those queries per-organisation would be the wrong fix. A uniqueness
constraint the database enforces globally has to be *checked* globally, or the
serialiser reports "available" for a value the INSERT then rejects. So the
check stays cross-tenant and says so, which is the escape hatch the guard's
docstring asks for: explicit and greppable.

Apply to any ModelSerializer over a ``TenantModel`` whose Meta.model carries a
unique field or a unique_together. ``tests/test_tenancy.py`` asserts none is
left unmixed.
"""

from rest_framework.relations import ManyRelatedField, RelatedField
from rest_framework.validators import UniqueValidator

from apps.common.models import TenantManager, TenantQuerySet


def unscope(queryset):
    """Mark a tenant queryset as a deliberate cross-tenant read.

    Accepts a manager or a queryset; anything that is not tenant-guarded is
    returned untouched so this is safe to apply blindly.
    """
    if isinstance(queryset, TenantManager):
        queryset = queryset.all()
    if isinstance(queryset, TenantQuerySet):
        return queryset.unscoped()
    return queryset


def scope_related_fields(serializer, org) -> None:
    """Constrain every writable relation on `serializer` to one organisation.

    DRF builds a relational field's queryset from the target model's
    ``_default_manager`` and never filters it, so out of the box
    ``{"caller_id": "<uuid>"}`` resolves against *every* tenant's rows. The
    view's ``get_queryset`` does not help: it governs which rows a request can
    read, not which primary keys the body may name. Left alone, one tenant can
    pin another tenant's caller ID, contact list or flow version to its own
    campaign — the guard in ``apps.common.models`` catches the unscoped read,
    but only raises when ``TENANCY_STRICT`` is on, and it is off in production.

    Scoping the queryset turns that into an ordinary "object does not exist"
    validation error, which is also the right answer for the tenant: a row it
    cannot see should not be a row it can name.

    Non-tenant relations (users, organisations) are left untouched.
    """
    # many=True hands back a ListSerializer, which holds the real fields on its
    # child rather than exposing `.fields` itself.
    serializer = getattr(serializer, "child", serializer)
    for field in serializer.fields.values():
        # A many=True relation wraps the real field in ManyRelatedField.
        target = field.child_relation if isinstance(field, ManyRelatedField) else field
        if not isinstance(target, RelatedField):
            continue
        queryset = getattr(target, "queryset", None)
        if queryset is None:  # read-only relation
            continue
        if isinstance(queryset, TenantManager):
            queryset = queryset.all()
        if isinstance(queryset, TenantQuerySet):
            target.queryset = queryset.for_org(org)


def add_org_scoped_unique_validators(serializer, org) -> None:
    """Validate the model's per-organisation unique constraints.

    DRF derives ``UniqueTogetherValidator`` only from constraints whose every
    field is on the serialiser. Constraints like ``("organization", "name")``
    never qualify, because ``organization`` is supplied by the view rather than
    the request body. The result is that a duplicate name reaches the INSERT
    and comes back as an IntegrityError — a 500 on what is an ordinary
    validation failure.

    Adding the validator over the remaining fields, scoped to this
    organisation, is equivalent to the constraint the database enforces.

    Conditional constraints are skipped: ``UniqueTogetherValidator`` has no way
    to express a ``condition``, and a validator that ignored it would reject
    rows the database would have accepted.
    """
    from django.db.models import UniqueConstraint
    from rest_framework.validators import UniqueTogetherValidator

    serializer = getattr(serializer, "child", serializer)
    model = getattr(getattr(serializer, "Meta", None), "model", None)
    if model is None:
        return

    fields = serializer.fields
    existing = {
        tuple(v.fields) for v in serializer.validators
        if isinstance(v, UniqueTogetherValidator)
    }
    for constraint in model._meta.constraints:
        if not isinstance(constraint, UniqueConstraint):
            continue
        if constraint.condition is not None:
            continue
        if "organization" not in constraint.fields:
            continue
        scoped_fields = tuple(f for f in constraint.fields if f != "organization")
        if not scoped_fields or tuple(scoped_fields) in existing:
            continue
        # Every remaining field must be writable here, or the validator cannot
        # read a value to check.
        if any(f not in fields or fields[f].read_only for f in scoped_fields):
            continue
        queryset = model._default_manager.all()
        if isinstance(queryset, TenantQuerySet):
            queryset = queryset.for_org(org)
        serializer.validators.append(
            UniqueTogetherValidator(queryset=queryset, fields=scoped_fields)
        )


class UnscopedUniqueValidatorsMixin:
    """Point DRF's generated uniqueness validators at an unscoped queryset.

    Must precede ``ModelSerializer`` in the bases. Only the validators DRF
    derives from model constraints are rewritten — a validator written by hand
    on the serialiser keeps whatever queryset its author chose.
    """

    def get_fields(self):
        fields = super().get_fields()
        for field in fields.values():
            for validator in getattr(field, "validators", []):
                if isinstance(validator, UniqueValidator):
                    validator.queryset = unscope(validator.queryset)
        return fields

    def get_unique_together_validators(self):
        validators = super().get_unique_together_validators()
        for validator in validators:
            validator.queryset = unscope(validator.queryset)
        return validators
