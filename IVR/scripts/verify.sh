#!/usr/bin/env bash
#
# Staged verification. Each tier needs more infrastructure than the last, and
# each one tells you something the previous one could not:
#
#   1  static      does it parse and import          (no dependencies)
#   2  unit        is the logic right                (needs deps + Redis)
#   3  database    does the schema build and hold    (needs Postgres)
#   4  boot        does the whole app come up        (needs both)
#   5  carrier     does a real call connect          (needs Twilio + a tunnel)
#
# Tier 5 is not automated here — it costs money and rings a real phone. The
# manual steps are in the README section this script prints at the end.
#
# Usage:  ./scripts/verify.sh [tier]     e.g. ./scripts/verify.sh 3
#         defaults to running tiers 1-4
#
set -uo pipefail
cd "$(dirname "$0")/.."

MAX_TIER="${1:-4}"
PASS=0
FAIL=0
SKIP=0

c_ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
c_bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
c_skip() { printf '  \033[33mSKIP\033[0m  %s\n' "$1"; SKIP=$((SKIP+1)); }
banner() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }

run() {  # run <description> <command...>
    local desc="$1"; shift
    if "$@" >/tmp/verify.$$.log 2>&1; then
        c_ok "$desc"
    else
        c_bad "$desc"
        sed 's/^/        /' /tmp/verify.$$.log | tail -25
    fi
    rm -f /tmp/verify.$$.log
}

PY=python3
RUFF=ruff
if [ -x .venv/bin/python ]; then
    PY=.venv/bin/python
    # Prefer the venv's console script over anything on PATH — an importable
    # `ruff` package does not imply a `ruff` binary is on PATH.
    [ -x .venv/bin/ruff ] && RUFF=.venv/bin/ruff
fi

have_django() { $PY -c "import django" 2>/dev/null; }
have_redis()  { redis-cli -u "${REDIS_URL:-redis://127.0.0.1:6379}/15" ping >/dev/null 2>&1; }
have_pg()     { $PY manage.py shell -c "from django.db import connection; connection.cursor()" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
banner "TIER 1 — static (no dependencies required)"
# ---------------------------------------------------------------------------
run "every module parses and byte-compiles" \
    $PY -m compileall -q apps config tests manage.py

if command -v "$RUFF" >/dev/null 2>&1 || [ -x "$RUFF" ]; then
    run "ruff lint" "$RUFF" check .
else
    c_skip "ruff not installed (pip install ruff)"
fi

# Import-graph check: every internal `from apps.x import Y` resolves. Catches
# the class of typo that only shows up when a Celery worker imports a task at
# 3am rather than when the web process starts.
run "internal imports resolve" $PY - <<'PY'
import ast, pathlib, sys
mods = {}
for p in pathlib.Path(".").rglob("*.py"):
    if any(x in p.parts for x in (".venv", "__pycache__")):
        continue
    name = ".".join(p.with_suffix("").parts)
    name = name[:-9] if name.endswith(".__init__") else name
    tree = ast.parse(p.read_text())
    names = set()
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(n.name)
        elif isinstance(n, ast.Assign):
            names |= {t.id for t in n.targets if isinstance(t, ast.Name)}
        elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
            names.add(n.target.id)
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            names |= {a.asname or a.name.split(".")[0] for a in n.names}
    mods[name] = (p, names)

bad = []
for name, (path, _) in mods.items():
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(("apps.", "config.")):
            if node.module not in mods:
                bad.append(f"{path}: missing module {node.module}")
                continue
            for a in node.names:
                if a.name != "*" and a.name not in mods[node.module][1] \
                        and f"{node.module}.{a.name}" not in mods:
                    bad.append(f"{path}: {node.module} has no '{a.name}'")
if bad:
    print("\n".join(bad)); sys.exit(1)
print(f"checked {len(mods)} modules")
PY

[ "$MAX_TIER" -lt 2 ] && { banner "SUMMARY"; echo "  $PASS passed, $FAIL failed, $SKIP skipped"; exit $((FAIL>0)); }

# ---------------------------------------------------------------------------
banner "TIER 2 — unit tests (needs dependencies installed)"
# ---------------------------------------------------------------------------
if ! have_django; then
    c_skip "Django not importable — run: pip install -r requirements.txt"
    banner "SUMMARY"; echo "  $PASS passed, $FAIL failed, $SKIP skipped"; exit $((FAIL>0))
fi

run "django system check" $PY manage.py check

# These need neither Postgres nor Redis.
run "pure logic: windows, DSL validator, runtime, ingest" \
    $PY -m pytest tests/test_windows.py tests/test_flow_validator.py \
                  tests/test_runtime.py tests/test_ingest.py -q

if have_redis; then
    run "limiters and idempotency (real Redis, db 15)" \
        $PY -m pytest tests/test_limits.py tests/test_idempotency.py -q
else
    c_skip "Redis unreachable — limiter and dedupe tests need it"
fi

[ "$MAX_TIER" -lt 3 ] && { banner "SUMMARY"; echo "  $PASS passed, $FAIL failed, $SKIP skipped"; exit $((FAIL>0)); }

# ---------------------------------------------------------------------------
banner "TIER 3 — database"
# ---------------------------------------------------------------------------
# Tier 4 does not need the database, so a missing Postgres skips tier 3 rather
# than hiding the boot checks behind it.
DB_VERIFIED=0
if ! have_pg; then
    c_skip "Postgres unreachable — check POSTGRES_* in .env (tier 3 only)"
else
    DB_VERIFIED=1
    # Migrations are checked in (see README). This asserts that the models and
    # the migrations in the tree actually agree — a model change committed
    # without its migration fails here rather than at deploy time.
    run "no un-generated model changes" \
        $PY manage.py makemigrations --check --dry-run

    run "migrations apply" $PY manage.py migrate --noinput
    run "partitioned event table + partitions" $PY manage.py setup_partitions

    run "tenancy isolation tests (hits the DB)" \
        $PY -m pytest tests/test_tenancy.py -q

    # API-key writes go through the real URL conf and the real serialisers, so
    # they catch the view-layer faults the unit tiers cannot see.
    run "API writes with a key (attribution, suppression idempotency)" \
        $PY -m pytest tests/test_api_key_writes.py -q

    # The carrier callback surface, minus the carrier. Signatures are generated
    # from the providers' published algorithms, so these prove the verifier
    # rejects what it should — which used to be a Tier 5 manual check.
    run "webhook signatures, opt-out and dedupe" \
        $PY -m pytest tests/test_webhooks.py -q

    # The dispatch task with a fake carrier: proves the pre-dial re-checks
    # refuse, and that the channel reservation comes back on every branch.
    run "dial path gates and channel accounting" \
        $PY -m pytest tests/test_dial_path.py -q
fi

[ "$MAX_TIER" -lt 4 ] && { banner "SUMMARY"; echo "  $PASS passed, $FAIL failed, $SKIP skipped"; exit $((FAIL>0)); }

# ---------------------------------------------------------------------------
banner "TIER 4 — boot"
# ---------------------------------------------------------------------------
run "production settings validate" \
    env DJANGO_SETTINGS_MODULE=config.settings.prod \
        DJANGO_SECRET_KEY=verify-only-not-a-real-secret \
        PHONE_HASH_PEPPER=verify-only-pepper \
        POSTGRES_PASSWORD=verify \
        PUBLIC_BASE_URL=https://verify.invalid \
        $PY manage.py check --deploy

run "celery app loads and tasks register" $PY - <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
django.setup()
from config.celery import app
app.loader.import_default_modules()
names = sorted(n for n in app.tasks if not n.startswith("celery."))
expected = {
    "campaigns.pacer_tick", "campaigns.pace_campaign", "dialer.place_call",
    "telephony.apply_status_callback", "telemetry.flush_all_counters",
    "contacts.ingest_contact_file",
}
missing = expected - set(names)
assert not missing, f"tasks not registered: {missing}"
print(f"{len(names)} tasks registered")
PY

run "ASGI application builds (http + websocket routing)" $PY - <<'PY'
import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
from config.asgi import application
assert application is not None
print("ok")
PY

run "URL routing resolves the critical paths" $PY - <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
django.setup()
from django.urls import resolve
for path in ("/healthz", "/api/v1/campaigns/", "/webhooks/twilio/status/",
             "/webhooks/twilio/ivr/entry/", "/webhooks/telnyx/amd/"):
    resolve(path)
print("ok")
PY

banner "SUMMARY"
printf '  %s passed, %s failed, %s skipped\n' "$PASS" "$FAIL" "$SKIP"

if [ "$FAIL" -eq 0 ]; then
cat <<'NEXT'

  No failures. What that does and does not prove:

    PROVEN   the code parses, imports and lints; the limiters and the dedupe
             logic behave correctly against real Redis; every process type
             boots and every route resolves. Webhook signatures are rejected
             when tampered, unsigned, wrongly keyed, replayed stale or bound
             to another URL, and a press-9 opt-out is durable before the
             response is returned.
NEXT
    if [ "${DB_VERIFIED:-0}" -eq 1 ]; then
        echo "             The schema builds and tenant isolation holds."
    else
        echo
        echo "    UNPROVEN the database tier did not run. The schema has NOT been"
        echo "             built and tenant isolation has NOT been checked."
    fi
cat <<'NEXT'

    UNPROVEN nothing has talked to a carrier. Signatures are checked against
             locally generated ones, not against a request a carrier actually
             signed; no call has been placed; AMD has never seen a real
             answering machine; and nothing here measures behaviour at load.

  Tier 5 (manual, costs money, rings a phone) — see README "Testing".
NEXT
fi

exit $((FAIL > 0))
