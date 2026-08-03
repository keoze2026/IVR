# Reference data

## `npa_jurisdictions.csv`

NANPA area code → US state, loaded with:

```bash
python manage.py load_npa_jurisdictions data/npa_jurisdictions.csv --truncate
```

**Provenance: community-maintained, not authoritative.** Derived from the
[Area-Code-Geolocation-Database](https://github.com/ravisorg/Area-Code-Geolocation-Database)
city-level dataset by taking the state of each area code's cities. Every one of
the 298 area codes in it resolved to exactly one state — there were no
conflicts to arbitrate — but the source is a GitHub project of unknown refresh
cadence, so **recent overlay area codes are probably missing**.

### Why that is currently safe, and when it stops being safe

This table only resolves an area code to a state string. It changes no dialing
decision on its own: `compliance/windows.py::_state_for_npa` looks the state up,
and if no `CallingWindow` row exists for that state the federal window applies
regardless. Loading it today is inert.

It stops being inert the moment you create per-state `CallingWindow` rows. At
that point a missing or wrong area code means a call placed against the wrong
statutory window, which is exactly the failure `COMPLIANCE.md` warns about —
*"a wrong entry in a shipped table is worse than no entry because it reads as
authoritative."*

**Before creating any `CallingWindow` rows, replace this file with the official
NANPA export** from <https://www.nationalnanpa.com> (Reports → NPA Records),
reload with `--truncate`, and have the result reviewed alongside the state
calling-hour rules themselves.

This file is checked in so the loader path is exercised and the format is
documented — not because it is fit for compliance use.

### Reloading does not take effect immediately

`_state_for_npa` caches each area-code lookup in Redis for an hour, including
negative results. After a `--truncate` reload, area codes queried before the
load keep resolving to their old value — usually `''` — until the entry
expires. Flush them explicitly:

```python
from django.core.cache import cache
cache.delete_many([f"npa:{n:03d}" for n in range(200, 1000)])
```

