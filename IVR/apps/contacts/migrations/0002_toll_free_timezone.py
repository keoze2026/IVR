"""
Give toll-free contacts imported earlier a mainland clock.

They were stored as `America/Adak`, the first North American zone in the number
metadata, so calling hours were read on the wrong clock.
"""

from django.db import migrations
from django.db.models import Q

# Written out here so that the migration does not change when the code does.
_TOLL_FREE_CODES = ("800", "833", "844", "855", "866", "877", "888")


def forwards(apps, schema_editor):
    Contact = apps.get_model("contacts", "Contact")
    toll_free = Q()
    for code in _TOLL_FREE_CODES:
        toll_free |= Q(phone_e164__startswith=f"+1{code}")
    Contact._base_manager.using(schema_editor.connection.alias).filter(
        toll_free, timezone="America/Adak"
    ).update(timezone="America/Chicago")


class Migration(migrations.Migration):
    dependencies = [("contacts", "0001_initial")]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
